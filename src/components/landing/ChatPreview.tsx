import type { ReactNode } from 'react';
import { X, Paperclip, Send, MessageCircle } from 'lucide-react';

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
              <p className="text-[13.5px] font-semibold text-white leading-tight">ZeloChat</p>
              <p className="text-[11px] text-[#25D366] leading-tight flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                Online
              </p>
            </div>
          </div>
          <button className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/80 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex">
          <div className="flex-1 px-4 py-5 space-y-3 min-h-[340px]">
            <BotBubble text="Olá! Como posso ajudar você hoje?" />
            <UserBubble text="Quais são as formas de pagamento?" time="09:00" />
            <BotBubble text="Aceitamos cartões de crédito, débito, PIX e dinheiro. Parcelamos em até 12x no cartão!" time="10:00" />
            <TypingBubble />
          </div>

          <aside className="hidden md:flex w-[180px] flex-col border-l border-white/5 bg-[#0B1120] px-3 py-4">
            <SidecarHeader>Resumo do atendimento</SidecarHeader>
            <SidecarItem label="Cliente" value="Juliana Silva" />
            <SidecarItem label="Canal" value="WhatsApp" />
            <SidecarItem label="Tags" value="Interesse em compra" />
            <SidecarItem
              label="Histórico"
              value={<span className="text-[#25D366]">Ver conversas</span>}
            />
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">Produto sugerido</p>
              <div className="flex items-center gap-2 rounded-md bg-white/5 p-1.5">
                <div className="w-8 h-8 rounded bg-gradient-to-br from-[#25D366]/30 to-[#25D366]/10 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-white leading-tight truncate">Cafeteira Express</p>
                  <p className="text-[10px] text-[#25D366] mt-0.5">R$ 499,90</p>
                </div>
              </div>
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

function BotBubble({ text, time }: { text: string; time?: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="w-6 h-6 rounded-full bg-[#25D366] flex items-center justify-center flex-shrink-0">
        <MessageCircle className="w-3 h-3 text-white" strokeWidth={2.4} />
      </div>
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-white/10 text-white text-[12.5px] px-3 py-2 leading-snug">
        {text}
        {time && <div className="text-[10px] text-white/40 mt-0.5 text-right">{time}</div>}
      </div>
    </div>
  );
}

function UserBubble({ text, time }: { text: string; time?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#25D366] text-white text-[12.5px] px-3 py-2 leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
        {text}
        {time && (
          <div className="text-[10px] text-white/70 mt-0.5 text-right tabular-nums">{time}</div>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2">
      <div className="w-6 h-6 rounded-full bg-[#25D366] flex items-center justify-center flex-shrink-0">
        <MessageCircle className="w-3 h-3 text-white" strokeWidth={2.4} />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2.5 flex items-center gap-1">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-white/70"
      style={{ animation: `lc-pulse-dot 1.2s ease-in-out ${delay}ms infinite` }}
    />
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
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="py-1.5 border-t border-white/5 first:border-t-0">
      <p className="text-[10px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className="text-[11.5px] text-white mt-0.5 leading-tight">{value}</p>
    </div>
  );
}
