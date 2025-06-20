/* eslint-disable n8n-nodes-base/node-param-description-boolean-without-whether */
import {
    INodeType,
    INodeTypeDescription,
    IExecuteFunctions,
    INodeExecutionData,
    NodeOperationError,
    NodeConnectionType,
} from 'n8n-workflow';

import {
    extractTextWithLayoutPaginated,
    extractJsonFromContent,
} from './pdfExtractor';

import { extractTextFromHtml } from './htmlExtractor';
import { maFonctionDeTraitementdetexte } from './Traitementdetexte';

export class Mistral implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Mistral PC4YOU',
        name: 'mistral',
        icon: 'file:mistral.svg',
        group: ['input'],
        version: 1,
        subtitle: '= POST {{$parameter["resource"]}}',
        description: 'Interagit avec l\'API Mistral et extrait le texte des PDF, HTML ou texte brut.', // Description mise à jour
        defaults: { name: 'MISTRAL' },
        // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
        inputs: ['main' as NodeConnectionType],
        // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
        outputs: ['main' as NodeConnectionType],
        credentials: [{ name: 'mistralApi', required: true }],
        properties: [
            {
                // eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
                displayName: 'Nom de la propriété binaire',
                name: 'binaryPropertyName',
                placeholder: "vide si le nom commence par 'attachment_'",
                type: 'string',
                default: '',
                description: 'Nom de la propriété binaire contenant le PDF. Laissez vide pour traiter toutes les pièces jointes de type PDF.',
            },
            {
                displayName: 'Phrases D\'Arrêt De Troncature',
                name: 'stopPhrases',
                type: 'fixedCollection',
                placeholder: 'Ajouter une phrase d\'arrêt',
                // eslint-disable-next-line n8n-nodes-base/node-param-description-excess-final-period
                description: 'Tronque le texte aux phrases spécifiées.',
                typeOptions: {
                    multipleValues: true,
                    sortable: true,
                },
                default: {},
                options: [
                    {
                        displayName: 'Phrase D\'Arrêt',
                        name: 'phrase',
                        values: [
                            {
                                displayName: 'Texte De La Phrase',
                                name: 'text',
                                type: 'string',
                                placeholder: 'Ex: Continuer à acheter',
                                default: '',
                                description: 'La phrase exacte à utiliser comme point d\'arrêt. Le texte sera tronqué juste avant cette phrase.',
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Question',
                name: 'question',
                type: 'string',
                typeOptions: {
                    rows: 9,
                },
                default: '',
                description: 'Question à poser à Mistral sur le contenu',
                required: true,
            },
        ],
    };

    // La méthode loadGeminiModels n'est pas applicable ici puisqu'il n'y a pas de sélecteur de modèle

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const credentials = await this.getCredentials('mistralApi') as {
            baseUrl: string;
            apiKey: string;
        };

        if (!credentials.baseUrl || !credentials.apiKey) {
            throw new NodeOperationError(this.getNode(), 'Les identifiants Mistral API (URL de base et clé API) ne sont pas configurés.');
        }

        const items = this.getInputData();
        const allReturnData: INodeExecutionData[] = []; // Collecte tous les résultats ici

        for (let i = 0; i < items.length; i++) {
            const question = this.getNodeParameter('question', i) as string;
            // Pas de selectedModel ici car le modèle est codé en dur
            const item = items[i];

            const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, '') as string;
            const binaryKeys = item.binary ? Object.keys(item.binary) : [];
            const attachmentKeys = binaryPropertyName
                ? [binaryPropertyName]
                : binaryKeys.filter(k => k.startsWith('attachment_'));

            const stopPhrasesCollection = this.getNodeParameter('stopPhrases', i) as { phrase?: { text: string }[] } | undefined;
            const stopPhrases: string[] = (stopPhrasesCollection?.phrase || []).map(item => item.text);

            let contentsToProcess: { text: string; sourceType: string; originalFileName?: string; isPdf: boolean; pagesData?: any[] }[] = [];

            // --- 1. Tenter le traitement PDF en premier (collecter tous les PDF) ---
            if (attachmentKeys.length > 0) {
                console.log("Tentative de traitement des fichiers PDF.");
                for (const attachmentKey of attachmentKeys) {
                    try {
                        const binaryData = this.helpers.assertBinaryData(i, attachmentKey);
                        const mimeType = binaryData.mimeType || '';
                        const buffer = Buffer.from(binaryData.data, 'base64');
                        const originalFileName = binaryData.fileName || attachmentKey;

                        if (mimeType === 'application/pdf' || attachmentKey.endsWith('.pdf')) {
                            const pagesData = await extractTextWithLayoutPaginated(buffer);
                            contentsToProcess.push({
                                text: '',
                                sourceType: `pdf - ${originalFileName}`,
                                originalFileName: originalFileName,
                                isPdf: true,
                                pagesData: pagesData,
                            });
                            console.log(`PDF '${originalFileName}' traité pour extraction des pages.`);
                            // PAS de 'break' ici pour que tous les PDF attachés soient traités
                        }
                    } catch (error) {
                        console.error(`Erreur lors du traitement du PDF '${attachmentKey}': ${(error as Error).message}`);
                        allReturnData.push({
                            json: {
                                error: `Échec du traitement du PDF '${attachmentKey}': ${(error as Error).message}`,
                                file: attachmentKey,
                            },
                        });
                    }
                }
            }

            // --- Logique de repli si aucun PDF n'a été trouvé ou traité avec succès ---
            if (contentsToProcess.length === 0) {
                // --- 2. Tenter le traitement item.json.text et item.json.html ---
                if (item.json?.text && item.json?.html) {
                    console.log("item.json?.text et item.json?.html présents. Traitement combiné.");
                    const initialHtml = String(item.json.html);
                    const initialText = String(item.json.text);
                    let combinedProcessedText = maFonctionDeTraitementdetexte(initialText, initialHtml);

                    if (stopPhrases.length > 0) {
                        let earliestStopIndex = -1;
                        for (const phrase of stopPhrases) {
                            const index = combinedProcessedText.indexOf(phrase);
                            if (index !== -1) {
                                if (earliestStopIndex === -1 || index < earliestStopIndex) {
                                    earliestStopIndex = index;
                                }
                            }
                        }
                        if (earliestStopIndex !== -1) {
                            combinedProcessedText = combinedProcessedText.substring(0, earliestStopIndex).trim();
                            console.log("Texte tronqué aux phrases d'arrêt configurables.");
                        } else {
                            console.log("Aucune phrase d'arrêt configurée trouvée dans le texte.");
                        }
                    } else {
                        console.log("La troncature par points d'arrêt est désactivée par l'option du nœud.");
                    }
                    contentsToProcess.push({ text: combinedProcessedText, sourceType: 'item_json_text_processed', isPdf: false });
                    console.log("item.json?.text traité par maFonctionDeTraitementdetexte.");
                } else if (item.json?.html || item.json?.htmlContent || item.json?.HTML || item.json?.textAsHtml) {
                    // --- 3. Si aucun contenu n'a été traité jusqu'à présent, tenter le traitement HTML brut ---
                    const htmlRawFallback = String(
                        item.json?.htmlContent ||
                        item.json?.HTML ||
                        item.json?.textAsHtml ||
                        item.json?.html ||
                        ''
                    );
                    const htmlTextFallback = htmlRawFallback ? extractTextFromHtml(htmlRawFallback) : '';

                    if (htmlTextFallback.length > 0) {
                        console.log("HTML brut détecté (hors item.json?.text). Traitement de la branche HTML.");
                        contentsToProcess.push({ text: htmlTextFallback, sourceType: 'html-only', isPdf: false });
                    }
                } else if (item.json?.text) {
                    // --- 4. Tenter le traitement du texte brut si présent et non combiné ---
                    const rawText = String(item.json.text);
                    if (rawText.length > 0) {
                        console.log("Texte brut détecté. Traitement de la branche Texte.");
                        let processedRawText = rawText;
                        if (stopPhrases.length > 0) {
                            let earliestStopIndex = -1;
                            for (const phrase of stopPhrases) {
                                const index = processedRawText.indexOf(phrase);
                                if (index !== -1) {
                                    if (earliestStopIndex === -1 || index < earliestStopIndex) {
                                        earliestStopIndex = index;
                                    }
                                }
                            }
                            if (earliestStopIndex !== -1) {
                                processedRawText = processedRawText.substring(0, earliestStopIndex).trim();
                                console.log("Texte brut tronqué aux phrases d'arrêt configurables.");
                            }
                        }
                        contentsToProcess.push({ text: processedRawText, sourceType: 'raw_text', isPdf: false });
                    }
                }
            }


            if (contentsToProcess.length === 0) {
                console.log("Aucune source de contenu détectée. Appel Mistral avec la question seule.");
                contentsToProcess.push({ text: '', sourceType: 'question_only', isPdf: false });
            }

            // --- Boucle sur tous les contenus à traiter (chaque PDF, ou l'unique source non-PDF) ---
            for (const contentData of contentsToProcess) {
                const originalFileName = contentData.originalFileName || 'N/A';
                const dataSourceType = contentData.sourceType;

                let finalMistralContent = '';
                let rawMistralResponsesForPdf: string[] = [];
                let extractedTextForOutput = contentData.text;

                let uniqueSupplierName: string | null = null;
                let uniqueReference: string | null = null;

                if (contentData.isPdf && contentData.pagesData) {
                    const pagesData = contentData.pagesData;
                    const OVERLAP_LINES = 5;

                    for (let pageIndex = 0; pageIndex < pagesData.length; pageIndex++) {
                        const currentPage = pagesData[pageIndex];
                        let textToSend = currentPage.text;

                        if (pageIndex > 0) {
                            const prevPageText = pagesData[pageIndex - 1].text;
                            const prevPageLines = prevPageText.split('\n');
                            const overlap = prevPageLines.slice(-OVERLAP_LINES).join('\n');
                            textToSend = overlap + '\n\n' + textToSend;
                            console.log(`Ajout de chevauchement de la page précédente à la page ${currentPage.pageNum} du fichier ${originalFileName}`);
                        }

                        const currentPrompt = `${question}\n\nContenu PDF extrait (Page ${currentPage.pageNum}/${pagesData.length} du fichier ${originalFileName}):\n${textToSend}`;

                        const body = {
                            model: 'mistral-7b-instruct', // Modèle Mistral codé en dur
                            max_tokens: 8000,
                            messages: [{ role: 'user', content: currentPrompt }],
                        };

                        const headers: Record<string, string> = {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${credentials.apiKey}`,
                        };

                        try {
                            console.log(`Envoi de la page ${currentPage.pageNum} du fichier ${originalFileName} à Mistral...`);
                            const response = await this.helpers.httpRequest({
                                method: 'POST',
                                url: `${credentials.baseUrl}/v1/chat/completions`,
                                headers,
                                body: JSON.stringify(body),
                                timeout: 1200000,
                            });

                            const content = response.choices?.[0]?.message?.content;

                            if (content) {
                                rawMistralResponsesForPdf.push(content);
                                console.log(`Réponse de l'IA pour la page ${currentPage.pageNum} du fichier ${originalFileName} reçue.`);

                                if (pageIndex === 0) {
                                    const nomFournMatch = content.match(/nom_fourn\s*:\s*([^;]+);/);
                                    if (nomFournMatch && nomFournMatch[1]) {
                                        uniqueSupplierName = nomFournMatch[1].trim();
                                    }
                                    const refMatch = content.match(/réf\s*:\s*([^;]+);/);
                                    if (refMatch && refMatch[1]) {
                                        uniqueReference = refMatch[1].trim();
                                    }
                                }
                            } else {
                                console.warn(`Aucune réponse de contenu de l'IA pour la page ${currentPage.pageNum} du fichier ${originalFileName}.`);
                                rawMistralResponsesForPdf.push(`ERROR: No content for page ${currentPage.pageNum}`);
                            }
                        } catch (error) {
                            console.error(`Erreur lors de l'appel Mistral pour la page ${currentPage.pageNum} du fichier ${originalFileName}: ${(error as Error).message}`);
                            rawMistralResponsesForPdf.push(`ERROR: API call failed for page ${currentPage.pageNum}: ${(error as Error).message}`);
                        }
                    }

                    if (uniqueSupplierName) {
                        finalMistralContent += `nom_fourn:${uniqueSupplierName};\n`;
                    }
                    if (uniqueReference) {
                        finalMistralContent += `réf:${uniqueReference};\n`;
                    }
                    const filteredResponses = rawMistralResponsesForPdf.filter(response => !response.startsWith('ERROR:'));
                    finalMistralContent += filteredResponses.join('\n');

                    extractedTextForOutput = JSON.stringify(pagesData);
                } else {
                    let prompt: string;
                    if (contentData.text) {
                        prompt = `${question}\n\nContenu extrait (Source: ${dataSourceType}):\n${contentData.text}`;
                    } else {
                        prompt = `${question}`;
                    }

                    const body = {
                        model: 'mistral-7b-instruct', // Modèle Mistral codé en dur
                        max_tokens: 8000,
                        messages: [{ role: 'user', content: prompt }],
                    };

                    const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${credentials.apiKey}`,
                    };

                    try {
                        console.log(`[DEBUG] Appel Mistral pour '${dataSourceType}' (fichier: ${originalFileName}).`);
                        const response = await this.helpers.httpRequest({
                            method: 'POST',
                            url: `${credentials.baseUrl}/v1/chat/completions`,
                            headers,
                            body: JSON.stringify(body),
                            timeout: 1200000,
                        });

                        finalMistralContent = response.choices?.[0]?.message?.content || '';
                    } catch (error) {
                        console.error(`[ERREUR] Erreur détaillée lors de l'appel Mistral (${dataSourceType}, fichier: ${originalFileName}):`, error);
                        throw new NodeOperationError(this.getNode(), `Erreur lors de l'appel Mistral (${dataSourceType}, fichier: ${originalFileName}): ${(error as Error).message}`);
                    }
                }

                const jsonStr = extractJsonFromContent(finalMistralContent || '');

                if (jsonStr) {
                    let jsonData;
                    try {
                        jsonData = JSON.parse(jsonStr);
                        allReturnData.push({
                            json: {
                                source: dataSourceType,
                                extractedText: extractedTextForOutput,
                                fileName: originalFileName,
                                data: jsonData,
                                rawMistralResponse: rawMistralResponsesForPdf.length > 0 ? rawMistralResponsesForPdf : finalMistralContent,
                            },
                        });
                    } catch (e) {
                        throw new NodeOperationError(this.getNode(), `JSON mal formé dans la réponse de l'IA pour ${dataSourceType} (fichier: ${originalFileName}): ${(e as Error).message}. Réponse brute: ${finalMistralContent || 'N/A'}`);
                    }
                } else {
                    allReturnData.push({
                        json: {
                            source: dataSourceType,
                            extractedText: extractedTextForOutput,
                            fileName: originalFileName,
                            rawContent: finalMistralContent || '',
                            error_parsing_json: `Pas de JSON détecté dans la réponse de ${dataSourceType} (fichier: ${originalFileName})`,
                        },
                    });
                }
            }
        }
        return [allReturnData];
    }
}
