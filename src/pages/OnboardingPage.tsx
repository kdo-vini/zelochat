import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFriendlyErrorMessage } from '../services/errorMessages';
import { signOut } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { apiUrl } from '../config';
import { ZeloChatLogo } from '../components/auth/AuthCard';
import OnboardingStep from '../components/onboarding/OnboardingStep';

type BusinessType =
  | 'Lanchonete'
  | 'Loja'
  | 'Restaurante'
  | 'Serviços'
  | 'Outro'
  | '';

const BUSINESS_TYPES: BusinessType[] = [
  'Lanchonete',
  'Loja',
  'Restaurante',
  'Serviços',
  'Outro',
];

/**
 * Brazilian IANA timezones the AI uses when computing "agora", "hoje" and
 * checking whether a pickup time has passed. Picked here in onboarding so the
 * empresa do Acre não vê "horário de Brasília" e os checks de horário usam
 * o relógio local da loja.
 */
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (UTC-3)' },
  { value: 'America/Bahia', label: 'Salvador / Bahia (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (UTC-3)' },
  { value: 'America/Recife', label: 'Recife (UTC-3)' },
  { value: 'America/Maceio', label: 'Maceió (UTC-3)' },
  { value: 'America/Belem', label: 'Belém (UTC-3)' },
  { value: 'America/Araguaina', label: 'Araguaína (UTC-3)' },
  { value: 'America/Santarem', label: 'Santarém (UTC-3)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (UTC-4)' },
  { value: 'America/Campo_Grande', label: 'Campo Grande (UTC-4)' },
  { value: 'America/Manaus', label: 'Manaus (UTC-4)' },
  { value: 'America/Boa_Vista', label: 'Boa Vista (UTC-4)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco / Acre (UTC-5)' },
  { value: 'America/Eirunepe', label: 'Eirunepé (UTC-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC-2)' },
];

const DEFAULT_TIMEZONE_OPTION = 'America/Sao_Paulo';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('');

  // Step 2 fields
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE_OPTION);

  const maskPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits.length ? `(${digits}` : '';
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  /**
   * Validates that the number is a Brazilian WhatsApp mobile number.
   * Accepts only 11-digit numbers: DDD (2 digits) + '9' + 8 subscriber digits.
   * Rejects 10-digit landlines (e.g. (11) 3333-4444).
   * WhatsApp Business só funciona em celular.
   */
  const isValidWhatsAppMobile = (raw: string): boolean => {
    const digits = raw.replace(/\D/g, '').replace(/^55/, '');
    return digits.length === 11 && digits[2] === '9';
  };

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    document.body.classList.add('landing-theme');
    return () => document.body.classList.remove('landing-theme');
  }, []);

  // Validate phone as user types — only show error once they've entered enough digits
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 0) {
      setPhoneError('');
      return;
    }
    if (digits.length >= 10 && !isValidWhatsAppMobile(phone)) {
      setPhoneError('Esse número parece ser um fixo. WhatsApp Business só funciona em celular (11 dígitos com 9). Confira o número.');
    } else {
      setPhoneError('');
    }
  }, [phone]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const isStep1Valid = companyName.trim().length > 0 && businessType !== '';
  const isStep2Valid = isValidWhatsAppMobile(phone);

  const handleStep1Next = () => {
    setErrorMsg('');
    if (!isStep1Valid) {
      setErrorMsg('Preencha todos os campos antes de continuar.');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isValidWhatsAppMobile(phone)) {
      setErrorMsg('Informe um número de celular válido com DDD (ex: (11) 99999-9999). Fixos não funcionam no WhatsApp.');
      return;
    }
    if (!user) {
      setErrorMsg('Sessão expirada. Faça login novamente.');
      return;
    }

    setLoading(true);

    // Attempt with tipo_negocio — fallback without it if column doesn't exist
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      user_id: user.id,
      nome_exibicao: companyName.trim(),
      contato: phone.replace(/\D/g, ''),
      tipo_negocio: businessType,
      timezone,
      zelochat_onboarding_done: true,
      // Anchor estável pro cálculo de "dia N" do follow-up sequence (server/onboardingFollowup.ts).
      // updated_at muda em qualquer edição posterior do perfil; este campo só é setado aqui.
      zelochat_onboarding_done_at: nowIso,
      updated_at: nowIso,
    };

    const { error } = await supabase
      .from('empresa_perfil')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      if (error.message.includes('tipo_negocio')) {
        console.warn('[OnboardingPage] tipo_negocio column missing — retrying without it.');
        const { tipo_negocio: _omit, ...payloadWithout } = payload;
        const { error: retryError } = await supabase
          .from('empresa_perfil')
          .upsert(payloadWithout, { onConflict: 'user_id' });

        if (retryError) {
          console.error('[OnboardingPage] upsert retry failed:', retryError);
          setErrorMsg(getFriendlyErrorMessage(retryError));
          setLoading(false);
          return;
        }
      } else {
        console.error('[OnboardingPage] upsert failed:', error);
        setErrorMsg(getFriendlyErrorMessage(error));
        setLoading(false);
        return;
      }
    }

    await refreshProfile();

    // Fire-and-forget: dispara o pacote de boas-vindas (Day 0 WhatsApp + Email).
    // Erro aqui não bloqueia o usuário de entrar no app — Resend ou Whatsmiau
    // podem estar fora; o cron diário pega o caso na próxima rodada se for o caso
    // (mas Day 0 não tem retry — aceitamos a perda).
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch(apiUrl('/api/onboarding/welcome'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        console.warn('[OnboardingPage] welcome dispatch failed (silently ignored):', err);
      }
    })();

    navigate('/app');
  };

  return (
    <div className="landing-theme min-h-screen bg-[#F8FAFC] flex flex-col">
      {/* Header */}
      <header className="w-full px-6 py-4 flex items-center justify-between bg-white border-b border-[#E5E7EB]">
        <ZeloChatLogo />
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-[#64748B] hover:text-[#0B1120] transition-colors font-medium"
        >
          Sair
        </button>
      </header>

      {/* Wizard card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl shadow-xl bg-white p-8">
          {/* Progress */}
          <div className="flex items-center justify-between mb-8">
            <p className="text-sm font-medium text-[#64748B]">
              Etapa {step} de 2
            </p>
            <div className="flex gap-2">
              {[1, 2].map((s) => (
                <div
                  key={s}
                  className={`h-1.5 w-10 rounded-full transition-colors ${
                    s <= step ? 'bg-[var(--color-brand)]' : 'bg-[#E5E7EB]'
                  }`}
                />
              ))}
            </div>
          </div>

          {step === 1 && (
            <OnboardingStep
              title="Sobre seu negócio"
              subtitle="Vamos personalizar o ZeloChat para o seu tipo de empresa."
            >
              <div className="space-y-4">
                {errorMsg && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                    {errorMsg}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="company-name"
                    className="block text-sm font-medium text-[#0B1120] mb-1"
                  >
                    Nome da empresa <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="company-name"
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Ex.: Lanchonete do João"
                    className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent text-[#0B1120] placeholder:text-[#64748B]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="business-type"
                    className="block text-sm font-medium text-[#0B1120] mb-1"
                  >
                    Tipo de negócio <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="business-type"
                    required
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                    className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent text-[#0B1120] bg-white"
                  >
                    <option value="" disabled>
                      Selecione o tipo de negócio
                    </option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleStep1Next}
                  disabled={!isStep1Valid}
                  className="w-full bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  Próximo →
                </button>
              </div>
            </OnboardingStep>
          )}

          {step === 2 && (
            <OnboardingStep
              title="Seu contato"
              subtitle="Informe como seus clientes podem te encontrar no WhatsApp."
            >
              <form onSubmit={handleSubmit} noValidate>
                <div className="space-y-4">
                  {errorMsg && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      {errorMsg}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="whatsapp-phone"
                      className="block text-sm font-medium text-[#0B1120] mb-1"
                    >
                      Telefone WhatsApp <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="whatsapp-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(maskPhone(e.target.value))}
                      placeholder="(XX) XXXXX-XXXX"
                      className={`border rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:border-transparent text-[#0B1120] placeholder:text-[#64748B] ${
                        phoneError
                          ? 'border-red-400 focus:ring-red-300'
                          : 'border-[#E5E7EB] focus:ring-[var(--color-brand)]'
                      }`}
                    />
                    {phoneError && (
                      <p className="mt-1.5 text-xs text-red-600 leading-snug">{phoneError}</p>
                    )}
                    {!phoneError && (
                      <p className="mt-1.5 text-xs text-[#64748B]">
                        Apenas celular (ex: (11) 99999-9999). Fixos não funcionam no WhatsApp.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="timezone"
                      className="block text-sm font-medium text-[#0B1120] mb-1"
                    >
                      Fuso horário <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="timezone"
                      required
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="border border-[#E5E7EB] rounded-lg h-11 px-3 w-full focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent text-[#0B1120] bg-white"
                    >
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-[#64748B]">
                      A IA usa esse fuso pra saber que horas são e checar horário de funcionamento.
                    </p>
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setStep(1);
                      }}
                      className="flex-1 bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[#0B1120] rounded-lg h-11 font-medium px-6 transition-colors"
                    >
                      ← Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !isStep2Valid}
                      className="flex-1 bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)] text-white rounded-lg h-11 font-semibold px-6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Salvando...' : 'Concluir e entrar'}
                    </button>
                  </div>
                </div>
              </form>
            </OnboardingStep>
          )}
        </div>
      </div>
    </div>
  );
}
