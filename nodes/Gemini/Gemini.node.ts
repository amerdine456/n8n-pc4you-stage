import {
    INodeType,
    INodeTypeDescription,
    IExecuteFunctions,
    INodeExecutionData,
    NodeOperationError,
    INodePropertyOptions,
    NodeConnectionType,
} from 'n8n-workflow';

import {
    extractTextWithLayout,
    extractJsonFromContent,
} from './pdfExtractor';

import { extractTextFromHtml, extractTextFromHtmlBuffer, } from './htmlExtractor';
import { maFonctionDeTraitementdetexte } from './Traitementdetexte';

// CLASSE RENOMMÉE EN GEMINI
export class Gemini implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Gemini PC4YOU',
        name: 'gemini',
				icon: 'file:google-brands.svg',
        group: ['input'],
        version: 1,
        subtitle: '= POST {{$parameter["resource"]}}',
        description: 'Interagit avec l\'API Gemini, extrait le texte des PDF ou autres sources, et répond à des questions.', // Description mise à jour
        defaults: { name: 'GEMINI' },
        // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
        inputs: ['main' as NodeConnectionType],
        // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
        outputs: ['main' as NodeConnectionType],
        credentials: [{ name: 'geminiApi', required: true }],
        properties: [
            {
                displayName: 'Modèle', // Traduit
                name: 'model',
                type: 'options',
                default: 'models/gemini-2.5-flash-preview-04-17', // Garde un modèle Gemini par défaut
                // eslint-disable-next-line n8n-nodes-base/node-param-description-excess-final-period
                description: 'Le modèle Gemini à utiliser.', // Traduit
                options: [
                    {
                        name: 'Gemini 2.5 Flash (Preview)', // Nom affiché dans n8n
                        value: 'models/gemini-2.5-flash-preview-04-17', // <--- NOM EXACT DE L'API ICI !
                    },

                ],
            },
            {
                // eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
                displayName: 'Nom de la propriété binaire', // Traduit
                name: 'binaryPropertyName',
                placeholder: "vide si le nom commence par 'attachment_' ",
                type: 'string',
                default: '',
                description: 'Nom de la propriété binaire contenant le PDF. Laissez vide pour traiter toutes les pièces jointes de type PDF.', // Description clarifiée
            },
            {
                displayName: 'Phrases D\'Arrêt De Troncature',
                name: 'stopPhrases',
                type: 'fixedCollection',
                placeholder: 'Ajouter une phrase d\'arrêt',
                // eslint-disable-next-line n8n-nodes-base/node-param-description-excess-final-period
                description: 'Tronquer le texte à ces phrases spécifiées.', // Traduit
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
                // eslint-disable-next-line n8n-nodes-base/node-param-description-untrimmed
                description: 'Question à poser à Gemini sur le contenu ', // Changé Mistral en Gemini
                required: true,
            },
        ],
    };

    async loadGeminiModels(this: IExecuteFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('geminiApi') as {
            baseUrl: string;
            apiKey: string;
        };

        if (!credentials.baseUrl || !credentials.apiKey) {
            return [];
        }

        try {
            const response = await this.helpers.httpRequest({
                method: 'GET',
                url: `${credentials.baseUrl}/v1beta/models?key=${credentials.apiKey}`,
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            const models = (response.models || [])
                .filter((model: any) => model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent'))
                .map((model: any) => ({
                    name: model.displayName || model.name.replace('models/', ''),
                    value: model.name,
                }));

            return models;
        } catch (error) {
            console.error('Erreur lors du chargement des modèles Gemini :', error);
            return [{ name: `Erreur: ${(error as Error).message}`, value: '' }];
        }
    }

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const credentials = await this.getCredentials('geminiApi') as {
            baseUrl: string;
            apiKey: string;
        };

        if (!credentials.baseUrl || !credentials.apiKey) {
            throw new NodeOperationError(this.getNode(), 'Les identifiants Gemini API (URL de base et clé API) ne sont pas configurés.');
        }

        const items = this.getInputData();
        const allReturnData: INodeExecutionData[] = []; // Collecte tous les résultats ici

        for (let i = 0; i < items.length; i++) {
            const question = this.getNodeParameter('question', i) as string;
            const selectedModel = this.getNodeParameter('model', i) as string;
            const item = items[i];

            const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, '') as string;
            const binaryKeys = item.binary ? Object.keys(item.binary) : [];
            const attachmentKeys = binaryPropertyName
                ? [binaryPropertyName]
                : binaryKeys.filter(k => k.startsWith('attachment_') || k.startsWith('data'));



            const stopPhrasesCollection = this.getNodeParameter('stopPhrases', i) as { phrase?: { text: string }[] } | undefined;
            const stopPhrases: string[] = (stopPhrasesCollection?.phrase || []).map(item => item.text);

            // Tableau pour stocker tous les contenus à traiter (chaque PDF, ou l'unique source de texte/HTML)
            let contentsToProcess: { text: string; sourceType: string; originalFileName?: string; originalBinaryData?: any }[] = [];

            // --- 1. Tenter le traitement PDF ou fichier.html en premier (collecter tous les PDF) ---
            if (attachmentKeys.length > 0) {
                console.log("Tentative de traitement des fichiers PDF.");
                for (const attachmentKey of attachmentKeys) {
                    try {
                        const binaryData = this.helpers.assertBinaryData(i, attachmentKey);
                        const mimeType = binaryData.mimeType || '';
                        const buffer = Buffer.from(binaryData.data, 'base64');

                        const originalFileName = binaryData.fileName || attachmentKey; // Conserver le nom du fichier

                        if (mimeType === 'application/pdf' || attachmentKey.endsWith('.pdf')) {
                            const pdfText = await extractTextWithLayout(buffer);
                            contentsToProcess.push({
                                text: pdfText,
                                sourceType: `pdf - ${originalFileName}`, // Indiquer la source et le nom du fichier
                                originalFileName: originalFileName,
																originalBinaryData: binaryData, // <-- STOCKER LE BINAIRE ORIGINAL ICI
                            });
                            console.log(`PDF '${originalFileName}' traité.`);
                        }else if (mimeType === 'text/plain' || attachmentKey.endsWith('.html')) {
													//console.log(`[DEBUG] Détection d'un fichier HTML binaire : '${originalFileName}' (MIME: ${mimeType}).`);
													const htmlText = await extractTextFromHtmlBuffer(buffer);
													console.log(`[DEBUG] Texte extrait du HTML binaire (${originalFileName}): ${htmlText.substring(0, 200)}... (premiers 200 caractères)`); // Log du début du texte extrait
													contentsToProcess.push({
															text: htmlText,
															sourceType: `.html - ${originalFileName}`,
															originalFileName: originalFileName,
															originalBinaryData: binaryData,
													});
													//console.log(`[DEBUG] Fichier HTML binaire '${originalFileName}' ajouté à la liste de traitement.`);
											}
                    } catch (error) {
                        console.error(`Erreur lors du traitement du PDF '${attachmentKey}': ${(error as Error).message}`);
                    }
                }
            }

            // --- Logique de repli si aucun PDF n'a été trouvé ou traité ---
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
                    contentsToProcess.push({ text: combinedProcessedText, sourceType: 'item_json_text_processed' });
                    console.log("item.json?.text traité par maFonctionDeTraitementdetexte.");
                } else if (item.json?.html || item.json?.htmlContent || item.json?.HTML || item.json?.textAsHtml) {
                    // --- 3. Si aucun contenu n'a été traité jusqu'à présent, tenter le traitement HTML brut ---
                    const htmlRawFallback = String(
                        item.json?.htmlContent ||
                        item.json?.HTML ||
                        item.json?.textAsHtml ||
                        item.json?.html || // Inclure item.json.html ici aussi si pas combiné avec text
                        ''
                    );
                    const htmlTextFallback = htmlRawFallback ? extractTextFromHtml(htmlRawFallback) : '';

                    if (htmlTextFallback.length > 0) {
                        console.log("HTML brut détecté (hors item.json?.text). Traitement de la branche HTML.");
                        contentsToProcess.push({ text: htmlTextFallback, sourceType: 'html-only' });
                    }
                } else if (item.json?.text) {
                    // --- 4. Tenter le traitement du texte brut si présent et non combiné ---
                    const rawText = String(item.json.text);
                    if (rawText.length > 0) {
                        console.log("Texte brut détecté. Traitement de la branche Texte.");
                        let processedRawText = rawText; // Appliquer la troncature aussi au texte brut
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
                        contentsToProcess.push({ text: processedRawText, sourceType: 'raw_text' });
                    }
                }
            }


            // --- Appel(s) Final(aux) à l'API Gemini basé sur le(s) contenu(s) traité(s) ou la question seule ---
            if (contentsToProcess.length === 0) {
                // Si aucune source de contenu n'a été trouvée après toutes les tentatives, envoyer la question seule
                console.log("Aucune source de contenu détectée. Appel Gemini avec la question seule.");
                contentsToProcess.push({ text: '', sourceType: 'question_only' }); // Le texte sera vide, seule la question sera utilisée
            }

            // ... (le code précédent du nœud Gemini reste le même jusqu'à la boucle de traitement des contenus)

						 // Exécuter un appel Gemini pour chaque contenu collecté
						 for (const contentData of contentsToProcess) {
							const processedContentForGemini = contentData.text;
							const dataSourceType = contentData.sourceType;
							const originalFileName = contentData.originalFileName || 'N/A';

							let prompt: string;
							if (processedContentForGemini) {
									prompt = `${question}\n\nContenu extrait (Source: ${dataSourceType}):\n${processedContentForGemini}`;
							} else {
									prompt = `${question}`;
							}

							const apiPath = `${selectedModel}:generateContent`;
							const body = {
									contents: [{ parts: [{ text: prompt }] }],
									generationConfig: {
									maxOutputTokens: 8000,
							},
							};

							const headers: Record<string, string> = {
								'Content-Type': 'application/json',
							};

							try {
							const fullUrl = `${credentials.baseUrl}/v1beta/${apiPath}?key=${credentials.apiKey}`;
							const response = await this.helpers.httpRequest({
								method: 'POST',
								url: fullUrl,
								headers,
								body: JSON.stringify(body),
								timeout: 1200000,
							});

							const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
							const jsonStr = extractJsonFromContent(content || '');

							// Créez l'objet JSON de sortie une seule fois
							const outputJson: { [key: string]: any } = {
								source: dataSourceType,
								fileName: originalFileName,
								extractedText: processedContentForGemini, // Toujours inclure le texte extrait
							};

							if (jsonStr) {
								try {
									const jsonData = JSON.parse(jsonStr);
									outputJson.dataContent = jsonData; // Ajouter la propriété dataContent
									console.log(`JSON extrait pour ${originalFileName}:`, JSON.stringify(jsonData, null, 2));
								} catch (e) {
								// Si le JSON est mal formé, ajouter l'erreur et le contenu brut
									outputJson.rawContent = content || '';
									outputJson.error_parsing_json = `JSON mal formé dans la réponse de l'IA: ${(e as Error).message}`;
									console.error(`Erreur de parsing JSON pour ${originalFileName}:`, (e as Error).message);
								}
							} else {
									outputJson.rawContent = content || '';
									outputJson.error_parsing_json = `Pas de JSON détecté dans la réponse de ${dataSourceType}`;
									console.log(`Pas de JSON détecté pour ${originalFileName}.`);
							}

							// Créez l'item de sortie final avec le JSON construit et le binaire
							const finalItem: INodeExecutionData = {
									json: outputJson,
									binary: {}, // Initialiser le binaire comme un objet vide
							};

							// Copiez le contenu binaire ORIGINAL dans l'item de sortie final
							if (contentData.originalBinaryData) {
									// TypeScript sait maintenant que finalItem.binary est un objet ici
									const outputBinaryKey = `data`;
									finalItem.binary![outputBinaryKey] = contentData.originalBinaryData; // Utilisez l'opérateur "non-null assertion" (!)
							}

							allReturnData.push(finalItem); // Ajoutez l'item final à la liste des retours

					} catch (error) {
						console.error(`[ERREUR] Erreur détaillée lors de l'appel Gemini (${dataSourceType}, fichier: ${originalFileName}):`, error);
						throw new NodeOperationError(this.getNode(), `Erreur lors de l'appel Gemini (${dataSourceType}, fichier: ${originalFileName}): ${(error as Error).message}`);
					}
				}
			}
		return [allReturnData];
	}
}
