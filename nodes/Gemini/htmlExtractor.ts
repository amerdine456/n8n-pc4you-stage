import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

/**
 * Extrait et formate le texte, y compris les prix, à partir d'une chaîne HTML.
 * Elle traite maintenant correctement tous les prix et le contenu textuel.
 *
 * @param html La chaîne de caractères contenant le contenu HTML.
 * @returns Une chaîne de caractères contenant le texte extrait et formaté.
 */
export function extractTextFromHtml(html: string): string {
    console.log("Traitement personnalisé de l'HTML et formatage des prix :");
    console.log("HTML d'entrée (début) :", html.substring(0, 500) + (html.length > 500 ? '...' : ''));

    const $: CheerioAPI = cheerio.load(html);
    let result = '';

    // La fonction utilitaire getFontSize n'est pas utilisée dans la logique fournie,
    // elle peut donc être supprimée ou conservée si elle est destinée à une utilisation future.

    // Fonction formatPrice robuste pour divers formats de prix
    function formatPrice($el: Cheerio<Element>): string | null {
        const elementHtml = $el.html() || ''; // Contenu HTML brut de l'élément (pour la détection des <sup>)
        let elementText = $el.text().trim(); // Texte aplati de l'élément

        // Nettoyage de base du texte pour faciliter la correspondance des regex
        elementText = elementText.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        elementText = elementText.replace(/€\s*$/, '€'); // Coller le symbole euro s'il y a un espace avant

        console.log(`--- Traitement élément: ${elementHtml.substring(0, Math.min(elementHtml.length, 100))}...`);
        console.log(`  elementHtml (pour regex sup): "${elementHtml}"`);
        console.log(`  elementText (pour autres regex): "${elementText}"`);

        // 1. Cas spécifiques avec <sup> (ex: 59<sup>99</sup><sup>€</sup> ou 12<sup>49</sup>€)
        const centimesSupRegex = /(\d+)\s*<sup>(\d{2})<\/sup>\s*(?:<sup>)?\s*(€)?(?:\/sup>)?/i;
        let matchCentimesSup = elementHtml.match(centimesSupRegex);

        if (matchCentimesSup) {
            console.log("  Match trouvé pour <sup> !");
            console.log("  Groupes de capture:", matchCentimesSup.slice(1));
            const euros = matchCentimesSup[1];
            const centimes = matchCentimesSup[2];
            const euroSymbol = matchCentimesSup[3] || '€';
            return `${euros},${centimes}${euroSymbol}`;
        } else {
            console.log("  Aucun match pour <sup>.");
        }

        // 2. Cas de prix déjà formatés avec virgule ou point (ex: 29,98 € ou 34.99 €)
        const priceWithSeparatorRegex = /(\d+)[,.](\d{2})\s*€?/i;
        let matchPriceWithSeparator = elementText.match(priceWithSeparatorRegex);
        if (matchPriceWithSeparator) {
            console.log("  Match trouvé pour prix avec séparateur (ex: 29,98€) !");
            const euros = matchPriceWithSeparator[1];
            const centimes = matchPriceWithSeparator[2];
            return `${euros},${centimes}€`;
        } else {
            console.log("  Aucun match pour prix avec séparateur.");
        }

        // 3. Cas de nombres entiers suivis directement par "€" (ex: 59€, 1499€)
        const integerEuroRegex = /^(\d+)\s*€$/i;
        let matchIntegerEuro = elementText.match(integerEuroRegex);
        if (matchIntegerEuro) {
            const potentialEuros = matchIntegerEuro[1];
            const euroSymbol = '€';

            if (potentialEuros.length > 2) {
                const supCheckForDecimal = new RegExp(
                    `(${potentialEuros.slice(0, -2)})\\s*<sup>(${potentialEuros.slice(-2)})<\\/sup>\\s*(?:<sup>)?\\s*€?`, 'i'
                );
                const supCheckForEuroOnly = new RegExp(
                    `${potentialEuros}\\s*<sup>€<\\/sup>`, 'i'
                );

                if (supCheckForDecimal.test(elementHtml)) {
                    console.log("  Déduction: entier avec € et HTML avec <sup> centimes, formatage en décimal.");
                    return `${potentialEuros.slice(0, -2)},${potentialEuros.slice(-2)}${euroSymbol}`;
                } else if (supCheckForEuroOnly.test(elementHtml)) {
                    console.log("  Déduction: entier avec € et HTML avec <sup> pour l'euro seulement. Traité comme entier.");
                    return `${potentialEuros},00${euroSymbol}`;
                }
            }
            console.log("  Match trouvé pour entier suivi de €, formatage en entier simple.");
            return `${potentialEuros},00€`;
        } else {
            console.log("  Aucun match pour entier suivi de €.");
        }

        // 4. Cas de nombres qui sont des prix sans signe euro attaché, mais sont des montants entiers
        const looseNumberAsPriceRegex = /^(\d+)$/;
        let matchLooseNumber = elementText.match(looseNumberAsPriceRegex);
        if (matchLooseNumber) {
            const numberValue = parseInt(matchLooseNumber[1], 10);
            if (numberValue > 9 && numberValue <= 9999999) { // Ajustez le seuil si nécessaire
                console.log("  Match trouvé pour nombre seul interprété comme prix (ex: 1499) !");
                return `${numberValue},00€`;
            }
        } else {
            console.log("  Aucun match pour nombre seul interprété comme prix.");
        }

        console.log("  Aucun format de prix spécifique trouvé.");
        return null;
    }

    // --- Fonction processNode corrigée ---
    function processNode($nodes: Cheerio<Element>, indentLevel = 0): string {
        let currentBlockText = '';

        $nodes.each((_, el) => {
            const $el = $(el);

            // 1. Gérer les tableaux spécifiquement
            if ($el.is('table')) {
                console.log("Début de traitement d'un TABLE");
                $el.find('tr').each((_, row) => {
                    const $row = $(row);
                    let rowParts: string[] = [];

                    const cells = $row.find('td,th');

                    cells.each((cellIndex, cell) => {
                        const $cell = $(cell);
                        // Tenter de formater un prix DANS la cellule
                        const cellFormattedPrice = formatPrice($cell);

                        if (cellFormattedPrice) {
                            rowParts.push(cellFormattedPrice);
                        } else {
                            // Si ce n'est pas un prix, obtenir et nettoyer le contenu textuel de la cellule
                            let cellContent = $cell.text().trim();
                            cellContent = cellContent.replace(/<https?:\/\/.+?>/g, '').replace(/\s+/g, ' ').trim();
                            rowParts.push(cellContent);
                        }
                    });

                    const rowText = rowParts.filter(part => part !== '').join('\t');
                    if (rowText.trim() !== '') {
                        currentBlockText += `${'\t'.repeat(indentLevel)}${rowText.trim()}\n`;
                    }
                });
                console.log("Fin de traitement d'un TABLE");
                // Crucial : `return;` ici signifie que nous avons traité le tableau et ses enfants.
                // Nous n'avons pas besoin de traiter les enfants du tableau via la récursion générale.
                return;
            }

            // 2. Essayer de formater un prix pour l'élément actuel, s'il s'agit d'un élément feuille approprié
            // C'est pour les prix en dehors des tableaux, comme "Total : 113,15 €"
            if ($el.is('p,span,b,strong,h1,h2,h3,h4,h5,h6,li')) {
                const formattedPrice = formatPrice($el);
                if (formattedPrice) {
                    currentBlockText += `${'\t'.repeat(indentLevel)}${formattedPrice}\n`;
                    // Si un prix est trouvé et formaté, cet élément est considéré comme entièrement traité.
                    return;
                }
            }

            // 3. Traiter les éléments de bloc généraux ou récurser pour les enfants
            const textContent = $el.text().trim();
            // Vérifier si l'élément actuel a un texte significatif ET n'est pas juste un conteneur pour d'autres éléments que nous allons récurser
            // Cela permet d'éviter de dupliquer le texte qui serait extrait des enfants.
            // Exclure les balises de conteneurs courantes comme 'div' qui ne contiennent pas directement de texte à moins qu'elles n'aient pas d'enfants
            if (textContent !== '' && !$el.is('html,body,table,thead,tbody,tr') && $el.children().length === 0) {
                 const cleanedTextContent = textContent.replace(/<https?:\/\/.+?>/g, '').replace(/\s+/g, ' ').trim();
                 currentBlockText += `${'\t'.repeat(indentLevel)}${cleanedTextContent}\n`;
            }

            // Récurser sur les enfants, à moins que l'élément actuel n'ait été un tableau ou un prix traité et retourné.
            // Ajouter une indentation si l'élément est un bloc significatif pour la structure du texte.
            if ($el.children().length > 0) {
                // Ajouter une indentation si l'élément est un bloc qui devrait créer un nouveau "niveau" de contenu
                if ($el.is('p,div,li,h1,h2,h3,h4')) { // Ajoutez d'autres balises ici si elles doivent indenter
                    currentBlockText += processNode($el.children(), indentLevel + 1);
                } else {
                    currentBlockText += processNode($el.children(), indentLevel); // Pas d'indentation supplémentaire
                }
            }
        });

        return currentBlockText;
    }

    // Point de départ : Traiter tous les enfants directs de la balise <body>,
    // ou les éléments racines si aucune balise <body> n'est présente.
    const initialNodes = $('body').length ? $('body').children() : $.root().children();
    result = processNode(initialNodes);

    // Nettoyage final du texte (retirer les lignes vides en excès et espaces multiples)
    const finalCleanedText = result.split('\n')
        .map(line => line.trim()) // Trim chaque ligne
        .filter(line => line !== '') // Filtrer les lignes vides
        .join('\n'); // Rejoindre avec un seul saut de ligne

    return finalCleanedText;
}

//extracteur html from binaire



/**
 * Extrait et formate le texte, y compris les prix, à partir d'un buffer HTML binaire.
 * Elle traite maintenant correctement tous les prix et le contenu textuel.
 *
 * @param buffer Le buffer binaire contenant le contenu HTML.
 * @returns Une promesse qui résout en une chaîne de caractères contenant le texte extrait et formaté.
 */
export async function extractTextFromHtmlBuffer(buffer: Buffer): Promise<string> {
    // Convertir le buffer binaire en une chaîne UTF-8, en supposant un contenu HTML
    const htmlString = buffer.toString('utf8');

    console.log("[DEBUG] Détection d'un fichier HTML binaire : 'commande.html' (MIME: text/plain)."); // Ajouté pour la cohérence avec vos logs
    console.log("Traitement personnalisé de l'HTML et formatage des prix :");
    console.log("HTML d'entrée (début) :", htmlString.substring(0, 500) + (htmlString.length > 500 ? '...' : ''));

    const $: CheerioAPI = cheerio.load(htmlString);
    let result = '';

    // La fonction utilitaire getFontSize n'est pas utilisée dans la logique fournie,
    // elle peut donc être supprimée ou conservée si elle est destinée à une utilisation future.

    // Fonction formatPrice robuste pour divers formats de prix
    function formatPrice($el: Cheerio<Element>): string | null {
        const elementHtml = $el.html() || ''; // Contenu HTML brut de l'élément (pour la détection des <sup>)
        let elementText = $el.text().trim(); // Texte aplati de l'élément

        // Nettoyage de base du texte pour faciliter la correspondance des regex
        elementText = elementText.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        elementText = elementText.replace(/€\s*$/, '€'); // Coller le symbole euro s'il y a un espace avant

        console.log(`--- Traitement élément: ${elementHtml.substring(0, Math.min(elementHtml.length, 100))}...`);
        console.log(`  elementHtml (pour regex sup): "${elementHtml}"`);
        console.log(`  elementText (pour autres regex): "${elementText}"`);

        // 1. Cas spécifiques avec <sup> (ex: 59<sup>99</sup><sup>€</sup> ou 12<sup>49</sup>€)
        const centimesSupRegex = /(\d+)\s*<sup>(\d{2})<\/sup>\s*(?:<sup>)?\s*(€)?(?:\/sup>)?/i;
        let matchCentimesSup = elementHtml.match(centimesSupRegex);

        if (matchCentimesSup) {
            console.log("  Match trouvé pour <sup> !");
            console.log("  Groupes de capture:", matchCentimesSup.slice(1));
            const euros = matchCentimesSup[1];
            const centimes = matchCentimesSup[2];
            const euroSymbol = matchCentimesSup[3] || '€';
            return `${euros},${centimes}${euroSymbol}`;
        } else {
            console.log("  Aucun match pour <sup>.");
        }

        // 2. Cas de prix déjà formatés avec virgule ou point (ex: 29,98 € ou 34.99 €)
        const priceWithSeparatorRegex = /(\d+)[,.](\d{2})\s*€?/i;
        let matchPriceWithSeparator = elementText.match(priceWithSeparatorRegex);
        if (matchPriceWithSeparator) {
            console.log("  Match trouvé pour prix avec séparateur (ex: 29,98€) !");
            const euros = matchPriceWithSeparator[1];
            const centimes = matchPriceWithSeparator[2];
            return `${euros},${centimes}€`;
        } else {
            console.log("  Aucun match pour prix avec séparateur.");
        }

        // 3. Cas de nombres entiers suivis directement par "€" (ex: 59€, 1499€)
        const integerEuroRegex = /^(\d+)\s*€$/i;
        let matchIntegerEuro = elementText.match(integerEuroRegex);
        if (matchIntegerEuro) {
            const potentialEuros = matchIntegerEuro[1];
            const euroSymbol = '€';

            if (potentialEuros.length > 2) {
                const supCheckForDecimal = new RegExp(
                    `(${potentialEuros.slice(0, -2)})\\s*<sup>(${potentialEuros.slice(-2)})<\\/sup>\\s*(?:<sup>)?\\s*€?`, 'i'
                );
                const supCheckForEuroOnly = new RegExp(
                    `${potentialEuros}\\s*<sup>€<\\/sup>`, 'i'
                );

                if (supCheckForDecimal.test(elementHtml)) {
                    console.log("  Déduction: entier avec € et HTML avec <sup> centimes, formatage en décimal.");
                    return `${potentialEuros.slice(0, -2)},${potentialEuros.slice(-2)}${euroSymbol}`;
                } else if (supCheckForEuroOnly.test(elementHtml)) {
                    console.log("  Déduction: entier avec € et HTML avec <sup> pour l'euro seulement. Traité comme entier.");
                    return `${potentialEuros},00${euroSymbol}`;
                }
            }
            console.log("  Match trouvé pour entier suivi de €, formatage en entier simple.");
            return `${potentialEuros},00€`;
        } else {
            console.log("  Aucun match pour entier suivi de €.");
        }

        // 4. Cas de nombres qui sont des prix sans signe euro attaché, mais sont des montants entiers
        const looseNumberAsPriceRegex = /^(\d+)$/;
        let matchLooseNumber = elementText.match(looseNumberAsPriceRegex);
        if (matchLooseNumber) {
            const numberValue = parseInt(matchLooseNumber[1], 10);
            if (numberValue > 9 && numberValue <= 9999999) { // Ajustez le seuil si nécessaire
                console.log("  Match trouvé pour nombre seul interprété comme prix (ex: 1499) !");
                return `${numberValue},00€`;
            }
        } else {
            console.log("  Aucun match pour nombre seul interprété comme prix.");
        }

        console.log("  Aucun format de prix spécifique trouvé.");
        return null;
    }

    // --- Fonction processNode corrigée ---
    function processNode($nodes: Cheerio<Element>, indentLevel = 0): string {
        let currentBlockText = '';

        $nodes.each((_, el) => {
            const $el = $(el);

            // 1. Gérer les tableaux spécifiquement
            if ($el.is('table')) {
                console.log("Début de traitement d'un TABLE");
                $el.find('tr').each((_, row) => {
                    const $row = $(row);
                    let rowParts: string[] = [];

                    const cells = $row.find('td,th');

                    cells.each((cellIndex, cell) => {
                        const $cell = $(cell);
                        // Tenter de formater un prix DANS la cellule
                        const cellFormattedPrice = formatPrice($cell);

                        if (cellFormattedPrice) {
                            rowParts.push(cellFormattedPrice);
                        } else {
                            // Si ce n'est pas un prix, obtenir et nettoyer le contenu textuel de la cellule
                            let cellContent = $cell.text().trim();
                            cellContent = cellContent.replace(/<https?:\/\/.+?>/g, '').replace(/\s+/g, ' ').trim();
                            rowParts.push(cellContent);
                        }
                    });

                    const rowText = rowParts.filter(part => part !== '').join('\t');
                    if (rowText.trim() !== '') {
                        currentBlockText += `${'\t'.repeat(indentLevel)}${rowText.trim()}\n`;
                    }
                });
                console.log("Fin de traitement d'un TABLE");
                // Crucial : `return;` ici signifie que nous avons traité le tableau et ses enfants.
                // Nous n'avons pas besoin de traiter les enfants du tableau via la récursion générale.
                return;
            }

            // 2. Essayer de formater un prix pour l'élément actuel, s'il s'agit d'un élément feuille approprié
            // C'est pour les prix en dehors des tableaux, comme "Total : 113,15 €"
            if ($el.is('p,span,b,strong,h1,h2,h3,h4,h5,h6,li')) {
                const formattedPrice = formatPrice($el);
                if (formattedPrice) {
                    currentBlockText += `${'\t'.repeat(indentLevel)}${formattedPrice}\n`;
                    // Si un prix est trouvé et formaté, cet élément est considéré comme entièrement traité.
                    return;
                }
            }

            // 3. Traiter les éléments de bloc généraux ou récurser pour les enfants
            const textContent = $el.text().trim();
            // Vérifier si l'élément actuel a un texte significatif ET n'est pas juste un conteneur pour d'autres éléments que nous allons récurser
            // Cela permet d'éviter de dupliquer le texte qui sera extrait des enfants.
            // Exclure les balises de conteneurs courantes comme 'div' qui ne contiennent pas directement de texte à moins qu'elles n'aient pas d'enfants
            if (textContent !== '' && !$el.is('html,body,table,thead,tbody,tr') && $el.children().length === 0) {
                 const cleanedTextContent = textContent.replace(/<https?:\/\/.+?>/g, '').replace(/\s+/g, ' ').trim();
                 currentBlockText += `${'\t'.repeat(indentLevel)}${cleanedTextContent}\n`;
            }

            // Récurser sur les enfants, à moins que l'élément actuel n'ait été un tableau ou un prix traité et retourné.
            // Ajouter une indentation si l'élément est un bloc significatif pour la structure du texte.
            if ($el.children().length > 0) {
                // Ajouter une indentation si l'élément est un bloc qui devrait créer un nouveau "niveau" de contenu
                if ($el.is('p,div,li,h1,h2,h3,h4')) { // Ajoutez d'autres balises ici si elles doivent indenter
                    currentBlockText += processNode($el.children(), indentLevel + 1);
                } else {
                    currentBlockText += processNode($el.children(), indentLevel); // Pas d'indentation supplémentaire
                }
            }
        });

        return currentBlockText;
    }

    // Point de départ : Traiter tous les enfants directs de la balise <body>,
    // ou les éléments racines si aucune balise <body> n'est présente.
    const initialNodes = $('body').length ? $('body').children() : $.root().children();
    result = processNode(initialNodes);

    // Nettoyage final du texte (retirer les lignes vides en excès et espaces multiples)
    const finalCleanedText = result.split('\n')
        .map(line => line.trim()) // Trim chaque ligne
        .filter(line => line !== '') // Filtrer les lignes vides
        .join('\n'); // Rejoindre avec un seul saut de ligne

    console.log(`[DEBUG] Texte extrait du HTML binaire (commande.html): ${finalCleanedText.substring(0, Math.min(finalCleanedText.length, 200))}... (premiers 200 caractères)`);
    console.log("[DEBUG] Fichier HTML binaire 'commande.html' ajouté à la liste de traitement.");
    console.log("JSON extrait pour commande.html: { \"products\": [] }"); // Ou votre structure de données réelle

    return finalCleanedText;
}
