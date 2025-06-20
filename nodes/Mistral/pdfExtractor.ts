import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

interface PageData {
    pageNum: number;
    text: string;
}

export async function extractTextWithLayoutPaginated(buffer: Buffer): Promise<PageData[]> {
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdfDocument = await loadingTask.promise;

    const pagesContent: PageData[] = [];

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        let lastY: number | null = null;
        let line = '';
        let pageText = ''; // Texte pour la page actuelle

        for (const item of textContent.items) {
            // @ts-ignore
            const str = item.str as string;
            // @ts-ignore
            const transform = item.transform as number[];
            const y = transform[5]; // position verticale

            if (lastY !== null && Math.abs(lastY - y) > 5) {
                pageText += line.trimEnd() + '\n';
                line = '';
            }

            if (line.length > 0) {
                line += ' ';
            }
            line += str;
            lastY = y;
        }
        pageText += line.trimEnd(); // Ajouter la dernière ligne de la page

        pagesContent.push({
            pageNum: pageNum,
            text: pageText.trim(),
        });
    }

    return pagesContent;
}

export function extractJsonFromContent(text: string): string | null {
		const regex = /```json\s*([\s\S]*?)```/;
		const regex1 = /"{\s*([\s\S]*?)}"/;
		const regex2 = /'{\s*([\s\S]*?)}'/;
		const match = text.match(regex) || text.match(regex1) || text.match(regex2);
		if (match && match[1]) {
				return match[1].trim();
		}

		try {
				const parsed = JSON.parse(text);
				return JSON.stringify(parsed, null, 2);
		} catch { }

		const firstBrace = text.indexOf('{');
		const lastBrace = text.lastIndexOf('}');
		if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
				const possibleJson = text.substring(firstBrace, lastBrace + 1);
				try {
						JSON.parse(possibleJson);
						return possibleJson.trim();
				} catch {
						return null;
				}
		}
		return null;
}
