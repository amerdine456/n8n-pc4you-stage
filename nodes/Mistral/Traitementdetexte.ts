import * as cheerio from 'cheerio';



export function maFonctionDeTraitementdetexte(texte: string, htmlOriginal:string): string {
		console.log("Traitement personnalisé du champ 'text' :", texte.substring(0, 100) + (texte.length > 100 ? '...' : ''));
		console.log("Traitement personnalisé du champ 'html' :", htmlOriginal.substring(0, 100) + (htmlOriginal.length > 100 ? '...' : ''));
		let texteModifie = texte ;

		// Supprimer les URLS
		texteModifie = texteModifie.replace(/<https?:\/\/.+?>/g, '');
		// Supprimer les caractères de contrôle unicode et les espaces de largeur nulle.
		// Ces caractères peuvent être `\u200b` (Zero Width Space), `\uFEFF` (Byte Order Mark), etc.
		// Le `\uFEFF` ressemble à '͏', et `\u200B` ressemble à '‌'
		// Le `\u00A0` est un espace insécable.
		// Le `\u00AD` est un tiret conditionnel.
		// On ajoute aussi les caractères que j'ai pu observer dans votre texte comme `\u200C` (Zero Width Non-Joiner)
		// et `\u00A0` qui est un espace insécable, ainsi que `\u00AD` qui est un tiret conditionnel.
		// Enfin, le `\u00AD` est un tiret conditionnel.
		texteModifie = texteModifie.replace(/[\u200B\uFEFF\u00A0\u00AD\u200C\u200D\u200E\u200F\u061C\u180E\u2060-\u206F\uFFF9-\uFFFB\uFE00-\uFE0F]/g, '');

		texteModifie = texteModifie.replace(/\[image:.*?\][\s\n]*/g, '');

		// Charger l'HTML original avec Cheerio
		const $ = cheerio.load(htmlOriginal);

		// Collecte des remplacements
		let replacements: { index: number, originalLength: number, newString: string }[] = [];
		let debugInfo: string[] = [];

		// Nouvelle regex: cible les nombres suivis (ou précédés) d'un symbole € ou $
		// Elle cherche explicitement un symbole monétaire pour identifier un prix.
		// Ajout d'une capture pour le symbole monétaire s'il est présent.
		const pricePattern = /(?:([€$])\s*)?(\d+(?:[.,]\d+)?)\s*([€$])?/g;

		let match;
		while ((match = pricePattern.exec(texteModifie)) !== null) {
				const fullMatch = match[0];      // Ex: "1499,00€", "59,99", "$123"
				const preSymbol = match[1] || ''; // Symbole avant le nombre (ex: "€" ou "$")
				let numberString = match[2];     // Le nombre lui-même (ex: "1499,00", "59,99")
				const postSymbol = match[3] || ''; // Symbole après le nombre (ex: "€" ou "$")

				const startIndex = match.index;

				// **MODIFICATION ICI : Ne traiter le match comme un prix que s'il y a un symbole monétaire détecté.**
				if (!preSymbol && !postSymbol) {
						 debugInfo.push(`--- Détection (non-prix): "${fullMatch}" à l'index ${startIndex} ---`);
						 debugInfo.push(`  -> IGNORÉ: Pas de symbole monétaire (€ ou $) détecté. C'est probablement un numéro.`);
						 continue; // Passer au match suivant
				}


				// Normalisation: retire les espaces, remplace le point par une virgule pour la cohérence
				numberString = numberString.replace(/\s/g, '').replace(/\./g, ',');

				const parsedNumber = parseFloat(numberString.replace(',', '.'));
				if (isNaN(parsedNumber)) {
						debugInfo.push(`--- Détection de prix: "${fullMatch}" (texte: "${numberString}") à l'index ${startIndex} ---`);
						debugInfo.push(`  -> IGNORÉ: "${numberString}" n'est pas un nombre valide.`);
						continue;
				}

				let foundSupTag = false;

				debugInfo.push(`--- Détection de prix: "${fullMatch}" (texte normalisé: "${numberString}") à l'index ${startIndex} ---`);
				debugInfo.push(`  Nombre traité: "${numberString}"`);

				// Logique spécifique pour les nombres entiers qui pourraient avoir des décimales en <sup>
				if (!numberString.includes(',') && numberString.length >= 3) {
						const potentialIntegerPart = numberString.slice(0, -2);
						const potentialDecimalPart = numberString.slice(-2);

						debugInfo.push(`  Analyse pour <sup>: entier potentiel "${potentialIntegerPart}", décimal potentiel "${potentialDecimalPart}"`);

						$(`td:contains(${numberString})`).each((_ , element) => {
								const $cell = $(element);
								const cellHtml = $cell.html() || '';
								const cellText = $cell.text().trim();

								debugInfo.push(`    Vérification de la cellule (texte): "${cellText.substring(0, Math.min(cellText.length, 50))}..." (HTML: "${cellHtml.substring(0, Math.min(cellHtml.length, 50))}...")`);

								if (cellText.includes(numberString) && cellText.includes('€')) {
										const supPatternDecimal = new RegExp(`${potentialIntegerPart}<sup>${potentialDecimalPart}<\/sup>`, 'i');
										const supPatternEuro = new RegExp(`${potentialIntegerPart}${potentialDecimalPart}<sup>€<\/sup>`, 'i');
										const supPatternCombined = new RegExp(`${potentialIntegerPart}<sup>${potentialDecimalPart}<\/sup><sup>€<\/sup>`, 'i');

										const isSupDecimal = supPatternDecimal.test(cellHtml);
										const isSupEuro = supPatternEuro.test(cellHtml);
										const isSupCombined = supPatternCombined.test(cellHtml);

										debugInfo.push(`      Patterns <sup> testés: Decimal=${isSupDecimal}, Euro=${isSupEuro}, Combined=${isSupCombined}`);

										if (isSupDecimal || isSupEuro || isSupCombined) {
												foundSupTag = true;
												debugInfo.push(`      -> <sup> DÉTECTÉ pour "${numberString}"`);
												return false;
										}
								}
								return true;
						});
				}

				let finalFormattedPrice = numberString;

				if (foundSupTag) {
						finalFormattedPrice = `${numberString.slice(0, -2)},${numberString.slice(-2)}`;
						debugInfo.push(`  -> Prix formaté en décimal via <sup>: "${finalFormattedPrice}"`);
				} else {
						debugInfo.push(`  -> Aucun <sup> détecté pour "${numberString}"`);

						const parts = finalFormattedPrice.split(',');
						if (parts.length === 2) {
								const integerPart = parts[0];
								const decimalPart = parts[1];
								if (decimalPart.length === 0) {
										finalFormattedPrice = `${integerPart},00`;
								} else if (decimalPart.length === 1) {
										finalFormattedPrice = `${integerPart},${decimalPart}0`;
								} else if (decimalPart.length > 2) {
										finalFormattedPrice = `${integerPart},${decimalPart.substring(0,2)}`;
								}
						} else if (parts.length === 1 && finalFormattedPrice.length > 0 && !isNaN(parseFloat(finalFormattedPrice.replace(',', '.')))) {
								// Si c'est un nombre entier (ex: "59", "1499") et aucun <sup> n'a été trouvé,
								// et qu'il y avait un symbole € ou $ dans le fullMatch original
								if (preSymbol || postSymbol) {
										// Si un symbole monétaire était présent, on peut décider de lui ajouter ",00"
										finalFormattedPrice = `${finalFormattedPrice},00`;
										debugInfo.push(`  -> Prix entier formaté en décimal par défaut (symbole présent): "${finalFormattedPrice}"`);
								}
						}
						debugInfo.push(`  -> Prix après normalisation décimale (sans <sup>): "${finalFormattedPrice}"`);
				}

				// **MODIFICATION ICI : La logique d'ajout/repositionnement du symbole est plus stricte.**
				// On n'ajoute pas de symbole si aucun n'était présent dans le fullMatch original.
				const actualSymbol = postSymbol || preSymbol; // Utilise le symbole qui a été trouvé.

				if (actualSymbol) { // Traiter uniquement si un symbole monétaire a été détecté par la regex
						if (finalFormattedPrice.includes(actualSymbol)) {
								// Si le symbole est déjà là, assurez-vous qu'il est à la fin
								if (finalFormattedPrice.indexOf(actualSymbol) !== finalFormattedPrice.length - actualSymbol.length) {
										finalFormattedPrice = finalFormattedPrice.replace(actualSymbol, '').trim() + actualSymbol;
										debugInfo.push(`  -> Symbole '${actualSymbol}' repositionné: "${finalFormattedPrice}"`);
								}
						} else {
								// Si le symbole n'est pas là mais qu'il a été détecté dans le fullMatch, ajoutez-le
								finalFormattedPrice += actualSymbol;
								debugInfo.push(`  -> Symbole '${actualSymbol}' ajouté: "${finalFormattedPrice}"`);
						}
				}
				// Si `!actualSymbol` (aucun symbole détecté par la regex), alors on ne fait rien pour le symbole.

				debugInfo.push(`  Résultat final pour le remplacement: "${fullMatch}" -> "${finalFormattedPrice}"`);
				replacements.push({
						index: startIndex,
						originalLength: fullMatch.length,
						newString: finalFormattedPrice
				});
		}

		// Appliquer les remplacements de droite à gauche pour éviter les problèmes d'indices
		//texteModifie = texte;
		replacements.sort((a, b) => b.index - a.index);

		for (const rep of replacements) {
				texteModifie =
						texteModifie.substring(0, rep.index) +
						rep.newString +
						texteModifie.substring(rep.index + rep.originalLength);
		}

		// Gérer le cas "59,99undefined" si ce n'est pas résolu par la logique ci-dessus.
		texteModifie = texteModifie.replace(/(\d+),(\d{2})undefined/g, '$1,$2€');

		return texteModifie + '\n\n--- Debug Info Prix ---\n' + debugInfo.join('\n');
}
