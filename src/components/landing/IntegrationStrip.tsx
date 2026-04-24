import { MessageCircle, Shield, Sparkles, Headphones } from 'lucide-react';
import { ZeloPDVLink } from './ZeloPDVLink';

const ITEMS = [
  { icon: MessageCircle, label: 'Pronto pra WhatsApp' },
  { icon: Shield, label: 'Seguro e confiável' },
  { icon: Sparkles, label: 'IA treinada para vender' },
  { icon: Headphones, label: 'Suporte em português' },
];

export function IntegrationStrip() {
  return (
    <section className="bg-[#0B1120] border-t border-white/5">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">
        <p className="text-center text-[13px] text-white/50 mb-5">
          Funciona sozinho — e se integra ao{' '}
          <ZeloPDVLink className="text-white/70 font-medium hover:text-white" />{' '}
          na mesma conta
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 items-center">
          {ITEMS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center justify-center gap-2 text-white/70">
              <Icon className="w-[18px] h-[18px] text-[#25D366]" strokeWidth={2} />
              <span className="text-[13.5px] font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
