import type { ReactNode } from 'react';
import {
  X,
  Paperclip,
  Send,
  MessageCircle,
  FileText,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Check,
} from 'lucide-react';

const WHATSAPP_BG = '#EFEAE2';
const WHATSAPP_USER_BUBBLE = '#D9FDD3';
const WHATSAPP_BOT_BUBBLE = '#FFFFFF';
const WHATSAPP_TEXT = '#111B21';
const WHATSAPP_META = '#667781';

// Subtle WhatsApp doodle pattern as inline SVG (tiled). Kept light to feel native.
const WHATSAPP_PATTERN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='%23000000' fill-opacity='0.035'><circle cx='15' cy='15' r='1.2'/><circle cx='75' cy='35' r='1.2'/><circle cx='45' cy='85' r='1.2'/><circle cx='100' cy='95' r='1.2'/><circle cx='30' cy='55' r='1.2'/><path d='M88 70c2-3 6-3 8 0' stroke='%23000' stroke-opacity='0.04' stroke-width='1.2' fill='none'/><path d='M10 95c3-2 7-2 10 0' stroke='%23000' stroke-opacity='0.04' stroke-width='1.2' fill='none'/></g></svg>\")";

export function ChatPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[32px] bg-[#25D366]/10 blur-3xl" />

      <div className="rounded-[20px] bg-[#0F172A] border border-white/10 shadow-[0_32px_80px_-20px_rgba(37,211,102,0.35)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center">
              <MessageCircle className="w-[18px] h-[18px] text-white" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[13.5px] font-semibold text-white leading-tight">
                Juliana Silva
              </p>
              <p className="text-[11px] text-[#25D366] leading-tight flex items-center gap-1 mt-0.5">
                <Sparkles className="w-2.5 h-2.5" />
                IA atendendo
              </p>
            </div>
          </div>
          <button className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex">
          <div
            className="flex-1 px-3.5 py-3.5 space-y-1.5"
            style={{
              backgroundColor: WHATSAPP_BG,
              backgroundImage: WHATSAPP_PATTERN,
            }}
          >
            <DateChip>HOJE</DateChip>
            <UserBubble time="20:12">
              Boa noite, quero 2 x-salada e uma Coca 2L. Faz entrega?
            </UserBubble>
            <BotBubble time="20:12">
              Boa noite! Fazemos sim 🛵
              <div className="mt-1.5 rounded-md bg-black/[0.04] border border-black/5 px-2.5 py-2 text-[11.5px] leading-snug">
                <Row label="2x X-Salada" value="R$ 49,80" />
                <Row label="1x Coca-Cola 2L" value="R$ 18,10" />
                <div className="mt-1 pt-1 border-t border-black/10 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>R$ 67,90</span>
                </div>
              </div>
              <div className="mt-1.5">Pode me enviar o endereço?</div>
            </BotBubble>
            <UserBubble time="20:13">
              Rua das Flores, 120. Vou pagar no PIX.
            </UserBubble>
            <BotBubble time="20:13">
              Perfeito. Pode mandar o comprovante por aqui que eu confiro nome e
              valor pra você.
            </BotBubble>
            <ReceiptBubble />
            <BotBubble time="20:14" tone="success">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#0B7A3B]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Comprovante validado — R$ 67,90
              </span>
            </BotBubble>
          </div>

          <aside className="hidden md:flex w-[200px] flex-col border-l border-white/5 bg-[#0B1120] px-3 py-4">
            <SidecarHeader>Status do pedido</SidecarHeader>
            <div className="rounded-md bg-[#25D366]/10 border border-[#25D366]/25 px-2 py-1.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#25D366]" />
              <span className="text-[11px] font-semibold text-[#25D366]">
                PIX analisado
              </span>
            </div>

            <SidecarItem label="Valor identificado" value="R$ 67,90" mt />
            <SidecarItem label="Cliente" value="Juliana Silva" />
            <SidecarItem label="Endereço" value="R. das Flores, 120" />

            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">
                Pedido detectado
              </p>
              <div className="rounded-md bg-white/5 border border-white/10 p-2">
                <p className="text-[11px] text-white leading-snug">
                  2x X-Salada
                  <br />
                  1x Coca-Cola 2L
                </p>
                <p className="text-[12px] text-[#25D366] font-semibold mt-1">
                  R$ 67,90
                </p>
              </div>
            </div>

            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">
                Próxima ação
              </p>
              <button className="w-full inline-flex items-center justify-between gap-1.5 rounded-md bg-[#25D366] hover:bg-[#1EBE5D] transition-colors px-2 py-1.5 text-[11px] font-semibold text-white">
                Enviar para preparo
                <ArrowRight className="w-3 h-3" strokeWidth={2.6} />
              </button>
            </div>
          </aside>
        </div>

        <div className="px-3 py-3 border-t border-white/5 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-lg bg-white/5 border border-white/10">
            <span className="flex-1 text-[12.5px] text-white/40">Digite sua mensagem...</span>
            <Paperclip className="w-4 h-4 text-white/40" />
          </div>
          <button className="w-10 h-10 rounded-lg bg-[#25D366] hover:bg-[#1EBE5D] text-white flex items-center justify-center transition-colors">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="absolute -bottom-4 -right-4 w-11 h-11 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(37,211,102,0.4)]">
        <MessageCircle className="w-5 h-5" />
      </div>
    </div>
  );
}

function DateChip({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center py-1">
      <span
        className="text-[10px] font-medium px-2 py-0.5 rounded-md shadow-sm"
        style={{ backgroundColor: '#FFFFFFCC', color: WHATSAPP_META }}
      >
        {children}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: WHATSAPP_TEXT }}>{label}</span>
      <span style={{ color: WHATSAPP_META }}>{value}</span>
    </div>
  );
}

function BotBubble({
  children,
  time,
  tone,
}: {
  children: ReactNode;
  time?: string;
  tone?: 'success';
}) {
  return (
    <div className="flex">
      <div
        className="relative max-w-[82%] rounded-lg rounded-tl-sm px-2.5 py-1.5 text-[12.5px] leading-snug shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]"
        style={{
          backgroundColor: tone === 'success' ? '#E7F7EC' : WHATSAPP_BOT_BUBBLE,
          color: WHATSAPP_TEXT,
        }}
      >
        <div className="pr-10">{children}</div>
        {time && (
          <span
            className="absolute bottom-1 right-2 text-[9.5px] tabular-nums"
            style={{ color: WHATSAPP_META }}
          >
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

function UserBubble({ children, time }: { children: ReactNode; time?: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="relative max-w-[82%] rounded-lg rounded-tr-sm px-2.5 py-1.5 text-[12.5px] leading-snug shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]"
        style={{ backgroundColor: WHATSAPP_USER_BUBBLE, color: WHATSAPP_TEXT }}
      >
        <div className="pr-12">{children}</div>
        {time && (
          <span
            className="absolute bottom-1 right-2 text-[9.5px] tabular-nums inline-flex items-center gap-0.5"
            style={{ color: WHATSAPP_META }}
          >
            {time}
            <DoubleCheck />
          </span>
        )}
      </div>
    </div>
  );
}

function DoubleCheck() {
  return (
    <span className="relative inline-flex items-center" style={{ color: '#53BDEB' }}>
      <Check className="w-3 h-3" strokeWidth={2.6} />
      <Check className="w-3 h-3 -ml-2" strokeWidth={2.6} />
    </span>
  );
}

function ReceiptBubble() {
  return (
    <div className="flex justify-end">
      <div
        className="relative rounded-lg rounded-tr-sm p-1.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]"
        style={{ backgroundColor: WHATSAPP_USER_BUBBLE }}
      >
        <div className="rounded-md bg-black/[0.04] border border-black/5 px-2.5 py-2 flex items-center gap-2 w-[210px]">
          <div className="w-9 h-9 rounded-md bg-[#25D366]/15 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-[#0B7A3B]" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p
              className="text-[11.5px] font-semibold leading-tight truncate"
              style={{ color: WHATSAPP_TEXT }}
            >
              comprovante-pix.pdf
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: WHATSAPP_META }}>
              PDF · 128 KB
            </p>
          </div>
        </div>
        <div
          className="text-[9.5px] mt-0.5 mr-1 text-right tabular-nums inline-flex items-center gap-0.5 justify-end w-full"
          style={{ color: WHATSAPP_META }}
        >
          20:14
          <DoubleCheck />
        </div>
      </div>
    </div>
  );
}

function SidecarHeader({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{children}</p>
  );
}

function SidecarItem({
  label,
  value,
  mt,
}: {
  label: string;
  value: ReactNode;
  mt?: boolean;
}) {
  return (
    <div className={`py-1.5 border-t border-white/5 ${mt ? 'mt-2' : ''}`}>
      <p className="text-[10px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className="text-[11.5px] text-white mt-0.5 leading-tight">{value}</p>
    </div>
  );
}
