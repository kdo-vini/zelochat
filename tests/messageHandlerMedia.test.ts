import { __mediaExtractionForTests as media } from '../server/messageHandler.ts';
import { assertEqual, runSuite } from './testHarness.js';

const pdfBase64 = 'JVBERi0xLjQK';
const pdfUrl = 'https://storage.googleapis.com/whatsmiau-test/comprovante.pdf';

await runSuite('Message handler media extraction', [
  {
    name: 'extracts PDF base64 from document wrapper',
    run: () => {
      const message = {
        message: {
          ephemeralMessage: {
            message: {
              documentWithCaptionMessage: {
                message: {
                  documentMessage: {
                    base64: pdfBase64,
                    mimetype: 'application/pdf; charset=binary',
                    fileName: 'comprovante.pdf',
                  },
                },
              },
            },
          },
        },
      };

      assertEqual(media.getInboundBase64Raw(message), pdfBase64, 'wrapped PDF base64 is preserved');
      assertEqual(media.normalizeDocumentMime('application/pdf; charset=binary'), 'application/pdf', 'PDF MIME parameters are normalized');
    },
  },
  {
    name: 'extracts public media URL from document wrapper',
    run: () => {
      const message = {
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: { mediaUrl: pdfUrl },
            },
          },
        },
      };

      assertEqual(media.getInboundMediaUrlRaw(message), pdfUrl, 'wrapped PDF media URL is preserved');
    },
  },
]);
