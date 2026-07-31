import { Modal, useModalTitleId } from '../Modal';
import { Download } from 'lucide-react';

interface PDFViewerProps {
  src: string;
  fileName: string;
  onClose: () => void;
}

/**
 * Inline PDF viewer modal. Uses a native iframe for http(s) URLs and an
 * <embed> fallback for data: URIs (Chrome blocks the built-in PDF viewer
 * for data: URLs in iframes). No external PDF dependency needed — the
 * browser's native viewer renders the file.
 */
export function PDFViewer({ src, fileName, onClose }: PDFViewerProps) {
  const titleId = useModalTitleId();

  const isDataUri = src.startsWith('data:');

  return (
    <Modal
      open
      onClose={onClose}
      titleId={titleId}
      containerClassName="fixed inset-0 z-[200] flex items-center justify-center p-4"
      backdropClassName="absolute inset-0 bg-black/90"
      panelLayoutClassName="w-[90vw] h-[90vh]"
      panelClassName="outline-none bg-white rounded-lg overflow-hidden"
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-black/10">
          <h3 id={titleId} className="text-sm font-medium text-[#111b21] truncate min-w-0">
            {fileName}
          </h3>
          <a
            href={src}
            download={fileName}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-white bg-[#00a884] hover:bg-[#008f6f] transition-colors no-underline flex-shrink-0"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            Baixar
          </a>
        </div>

        {/* PDF body — iframe for https, embed for data URIs */}
        <div className="flex-1 w-full bg-[#f0f2f5] min-h-0">
          {isDataUri ? (
            <embed src={src} type="application/pdf" className="w-full h-full" title={fileName} />
          ) : (
            <iframe src={src} className="w-full h-full border-0" title={fileName} />
          )}
        </div>
      </div>
    </Modal>
  );
}
