import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, RefreshCw, Wifi, WifiOff, QrCode, Loader2, Coffee, Clock, Bell, ShieldCheck } from 'lucide-react';
import { ZeloState } from '../../types';

export const WhatsAppIntegrationCard = () => {
  const [waStatus, setWaStatus] = useState<'disconnected' | 'qr' | 'connecting' | 'connected'>('disconnected');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const API_BASE = `http://${window.location.hostname}:3001`;
  const WS_URL = `ws://${window.location.hostname}:3001/ws`;

  // Connect to WS for real-time updates
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        // Fetch initial status
        fetch(`${API_BASE}/api/status`)
          .then(r => r.json())
          .then(data => setWaStatus(data.status))
          .catch(() => setError('Servidor WhatsApp offline'));

        fetch(`${API_BASE}/api/qr`)
          .then(r => r.json())
          .then(data => { if (data.qr) setQrCode(data.qr); })
          .catch(() => {});
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'qr') {
            setQrCode(parsed.data);
            setWaStatus('qr');
            setIsLoading(false);
          }
          if (parsed.type === 'connection') {
            setWaStatus(parsed.data);
            if (parsed.data === 'connected') {
              setQrCode(null);
              setError(null);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        setError('Não foi possível conectar ao servidor');
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  const refreshQR = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/qr`);
      const data = await res.json();
      if (data.qr) {
        setQrCode(data.qr);
        setWaStatus('qr');
      } else if (data.status === 'connected') {
        setWaStatus('connected');
      }
    } catch {
      setError('Servidor WhatsApp não encontrado. Execute: npm run dev:server');
    } finally {
      setIsLoading(false);
    }
  };

  const statusConfig = {
    connected: { color: 'bg-green-500', text: 'Conectado', textColor: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200', icon: Wifi },
    qr: { color: 'bg-amber-500', text: 'Aguardando QR Code', textColor: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', icon: QrCode },
    connecting: { color: 'bg-blue-500', text: 'Conectando...', textColor: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', icon: Loader2 },
    disconnected: { color: 'bg-gray-400', text: 'Desconectado', textColor: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200', icon: WifiOff },
  };

  const current = statusConfig[waStatus];
  const StatusIcon = current.icon;

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 font-sans">
          <Smartphone className="w-5 h-5 text-green-600" /> Integração WhatsApp
        </h3>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${current.bgColor} border ${current.borderColor}`}>
          <span className={`w-2 h-2 rounded-full ${current.color} ${waStatus === 'connecting' ? 'animate-pulse' : ''}`} />
          <span className={`text-[11px] font-bold ${current.textColor}`}>{current.text}</span>
        </div>
      </div>

      {waStatus === 'connected' ? (
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Wifi className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-sm font-bold text-gray-800 mb-1">WhatsApp Conectado!</p>
          <p className="text-xs text-gray-500 mb-4">Mensagens estão sendo recebidas e respondidas automaticamente pela IA.</p>
          <div className="flex items-center justify-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-green-600">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Auto-resposta ativa
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {qrCode ? (
            <div className="text-center">
              <div className="bg-white rounded-2xl p-3 border-2 border-dashed border-gray-200 inline-block mb-3">
                <img src={qrCode} alt="QR Code WhatsApp" className="w-48 h-48 mx-auto" />
              </div>
              <p className="text-xs text-gray-600 font-medium">Abra o <b>WhatsApp</b> no celular → <b>Dispositivos Conectados</b> → <b>Escanear QR Code</b></p>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <StatusIcon className={`w-7 h-7 text-gray-400 ${waStatus === 'connecting' ? 'animate-spin' : ''}`} />
              </div>
              <p className="text-sm text-gray-600 mb-1">
                {waStatus === 'connecting' ? 'Conectando ao WhatsApp...' : 'WhatsApp não conectado'}
              </p>
              <p className="text-xs text-gray-400 mb-4">
                {waStatus === 'connecting' ? 'Aguarde enquanto estabelecemos a conexão.' : 'Clique abaixo para gerar o QR Code de pareamento.'}
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
              <p className="text-xs text-red-600 font-medium">{error}</p>
            </div>
          )}

          <button
            onClick={refreshQR}
            disabled={isLoading || waStatus === 'connecting'}
            className="w-full flex items-center justify-center gap-2 bg-[#00a884] hover:bg-[#009175] disabled:bg-gray-300 text-white py-3 rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {qrCode ? 'Atualizar QR Code' : 'Gerar QR Code'}
          </button>
        </div>
      )}
    </div>
  );
};

export const SettingsView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 space-y-8 custom-scrollbar relative">
    <header>
      <h2 className="text-2xl font-bold text-gray-800">Configurações do Sistema</h2>
      <p className="text-sm text-gray-500">Gerencie informações da empresa, horários e preferências globais.</p>
    </header>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Coffee className="w-5 h-5 text-orange-600" /> Dados da Empresa</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Nome da Lanchonete</label>
              <input 
                type="text" 
                value={state.businessInfo.name}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, name: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Endereço de Retirada</label>
              <input 
                type="text" 
                value={state.businessInfo.address}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, address: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Telefone de Contato</label>
                <input 
                  type="text" 
                  value={state.businessInfo.phone}
                  onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, phone: e.target.value } }))}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Chave PIX (CNPJ/CPF)</label>
                <input 
                  type="text" 
                  value={state.businessInfo.pixKey}
                  onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, pixKey: e.target.value } }))}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Clock className="w-5 h-5 text-blue-600" /> Horários e Atendimento</h3>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Horário de Funcionamento</label>
              <input 
                type="text" 
                value={state.businessInfo.hours}
                onChange={(e) => setState(prev => ({ ...prev, businessInfo: { ...prev.businessInfo, hours: e.target.value } }))}
                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400" 
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Dias de Fechamento</label>
              <div className="flex gap-2 flex-wrap mt-2">
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(day => (
                   <button 
                    key={day}
                    onClick={() => {
                        const isClosed = state.businessInfo.closedDays.includes(day);
                        setState(prev => ({
                            ...prev,
                            businessInfo: {
                                ...prev.businessInfo,
                                closedDays: isClosed 
                                    ? prev.businessInfo.closedDays.filter(d => d !== day)
                                    : [...prev.businessInfo.closedDays, day]
                            }
                        }))
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${state.businessInfo.closedDays.includes(day) ? 'bg-red-500 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                   >
                     {day}
                   </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <WhatsAppIntegrationCard />

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 font-sans"><Bell className="w-5 h-5 text-purple-600" /> Preferências de Notificação</h3>
          <div className="space-y-4">
            {[
              { label: 'Som para novas mensagens', enabled: true },
              { label: 'Notificar pedidos acima de R$ 200', enabled: true },
              { label: 'Relatório diário por e-mail', enabled: false },
              { label: 'Alertar quando estoque acabar', enabled: true },
            ].map((opt, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{opt.label}</span>
                <div className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${opt.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${opt.enabled ? 'right-1' : 'left-1'}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#121b21] p-6 rounded-2xl text-white shadow-lg">
           <h3 className="font-bold mb-4 flex items-center gap-2 font-sans"><ShieldCheck className="w-5 h-5 text-green-500" /> Segurança</h3>
           <p className="text-xs opacity-70 mb-4">Seus dados de faturamento e clientes são protegidos por criptografia de ponta a ponta conforme o padrão WhatsApp.</p>
           <button className="w-full bg-white/10 hover:bg-white/20 py-2.5 rounded-xl text-xs font-bold transition-colors">Exportar Backup de Dados</button>
        </div>
      </div>
    </div>
  </div>
);
