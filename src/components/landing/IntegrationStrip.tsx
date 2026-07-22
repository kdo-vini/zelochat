import { MessageCircle, Shield, Sparkles, Headphones, Printer, Truck, UtensilsCrossed, BarChart3, Receipt, LayoutGrid, Bell } from 'lucide-react';
import { ZeloPDVLink } from './ZeloPDVLink';
import { Marquee } from './ui/Marquee';

const ITEMS = [
  { icon: MessageCircle, label: 'Conecta direto no WhatsApp' },
  { icon: Sparkles, label: 'IA treinada com seu cardápio' },
  { icon: UtensilsCrossed, label: 'Cardápio online próprio (incluso)' },
  { icon: Receipt, label: 'Confere comprovante PIX (foto ou PDF)' },
  { icon: LayoutGrid, label: 'Kanban com drag-and-drop' },
  { icon: Bell, label: 'Avisa o cliente a cada status' },
  { icon: Printer, label: 'Impressão automática na cozinha' },
  { icon: Truck, label: 'Gestão de entregadores' },
  { icon: BarChart3, label: 'Histórico e resumo por cliente' },
  { icon: Shield, label: 'Dados isolados por loja' },
  { icon: Headphones, label: 'Suporte em português' },
];

export function IntegrationStrip() {
  return (
    <section className="bg-[#0B1120] border-t border-white/5">
      <div className="max-w-[1400px] mx-auto py-7">
        <p className="text-center text-[13px] text-white/50 mb-5 px-6">
          Funciona sozinho — e se integra ao{' '}
          <ZeloPDVLink className="text-white/70 font-medium hover:text-white" />{' '}
          na mesma conta
        </p>
        <Marquee durationSeconds={50}>
          {ITEMS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/10 text-white/75"
            >
              <Icon className="w-[16px] h-[16px] text-[#25D366]" strokeWidth={2.2} aria-hidden="true" />
              <span className="text-[13px] font-medium whitespace-nowrap">{label}</span>
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
