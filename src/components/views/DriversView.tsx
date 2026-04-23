import React, { useState } from 'react';
import { Plus, MapPin, Bike, MessageCircle } from 'lucide-react';
import { ZeloState, DeliveryDriver, Order } from '../../types';

export const DriversView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => {
  const [newDriver, setNewDriver] = useState({ name: '', phone: '' });

  const handleAddDriver = () => {
    if (!newDriver.name || !newDriver.phone) return;
    setState(prev => ({
      ...prev,
      drivers: [...prev.drivers, {
        id: Date.now().toString(),
        name: newDriver.name,
        phone: newDriver.phone.replace(/\D/g, ''),
        status: 'available'
      }]
    }));
    setNewDriver({ name: '', phone: '' });
  };

  const notifyDriver = (driver: DeliveryDriver, order?: Order) => {
    let message = `Olá ${driver.name}, temos uma nova corrida para você!`;
    if (order && order.deliveryAddress) {
      message = `Olá ${driver.name}! Nova entrega!\n\nCliente: ${order.customerName}\nEndereço: ${order.deliveryAddress}\nTotal: R$ ${order.total.toFixed(2)}`;
    }
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${driver.phone}?text=${encoded}`, '_blank');
  };

  const pendingDeliveries = state.orders.filter(o => o.status === 'ready');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 space-y-8 custom-scrollbar relative">
      <header>
        <h2 className="text-2xl font-bold text-gray-800">Controle de Motoboys</h2>
        <p className="text-sm text-gray-500">Cadastre entregadores e despache pedidos via WhatsApp.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
             <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-orange-500" /> Cadastrar Motoboy</h3>
             <div className="space-y-4">
                <div>
                   <label className="text-[10px] font-bold text-gray-400 uppercase">Nome do Entregador</label>
                   <input 
                      type="text" 
                      value={newDriver.name}
                      onChange={(e) => setNewDriver(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400" 
                      placeholder="Ex: Tio Patinhas"
                   />
                </div>
                <div>
                   <label className="text-[10px] font-bold text-gray-400 uppercase">WhatsApp (Apenas Números)</label>
                   <input 
                      type="text" 
                      value={newDriver.phone}
                      onChange={(e) => setNewDriver(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400 font-mono" 
                      placeholder="Ex: 5511999999999"
                   />
                </div>
                <button 
                  onClick={handleAddDriver}
                  disabled={!newDriver.name || !newDriver.phone}
                  className="w-full bg-orange-500 text-white rounded-xl py-2.5 text-sm font-bold shadow-md hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  Adicionar Entregador
                </button>
             </div>
          </div>

          <div className="bg-[#121b21] p-6 rounded-2xl text-white shadow-lg">
             <h3 className="font-bold mb-4 flex items-center gap-2"><MapPin className="w-5 h-5 text-green-500" /> Central de Despacho</h3>
             <p className="text-xs opacity-70 mb-4">Pedidos prontos aguardando motoboy ({pendingDeliveries.length})</p>
             <div className="space-y-3">
               {pendingDeliveries.length === 0 && <p className="text-xs text-gray-400 italic">Nenhum pedido para entrega esperando no momento.</p>}
               {pendingDeliveries.map(order => (
                  <div key={order.id} className="bg-white/10 p-3 rounded-xl border border-white/5">
                     <p className="text-xs font-bold">{order.customerName}</p>
                     <p className="text-[10px] text-gray-400 truncate mb-2">{order.deliveryAddress || 'Retirada no local / Endereço não informado'}</p>
                     
                     <div className="flex gap-2">
                       <select 
                          className="bg-black/20 border border-white/10 rounded-lg outline-none text-[10px] px-2 py-1 flex-1"
                          onChange={(e) => {
                             const driver = state.drivers.find(d => d.id === e.target.value);
                             if (driver) notifyDriver(driver, order);
                          }}
                          defaultValue=""
                       >
                         <option value="" disabled>Chamar Motoboy...</option>
                         {state.drivers.map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.status})</option>
                         ))}
                       </select>
                     </div>
                  </div>
               ))}
             </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
           <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2"><Bike className="w-5 h-5 text-orange-500" /> Entregadores Ativos</h3>
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {state.drivers.map(driver => (
                <div key={driver.id} className="p-5 border border-gray-100 bg-gray-50 rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow">
                   <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center font-bold">
                            <Bike className="w-5 h-5" />
                         </div>
                         <div>
                           <h4 className="font-bold text-gray-800 text-sm">{driver.name}</h4>
                           <p className="text-xs text-gray-500 font-mono">+{driver.phone}</p>
                         </div>
                      </div>
                      <span className={`w-3 h-3 rounded-full ${driver.status === 'available' ? 'bg-green-500' : driver.status === 'busy' ? 'bg-orange-500' : 'bg-gray-400'}`} title={driver.status} />
                   </div>
                   
                   <div className="flex items-center gap-2 mt-auto">
                      <button 
                         onClick={() => notifyDriver(driver)}
                         className="flex-1 bg-[#25d366] hover:bg-[#20bd5a] text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
                      >
                         <MessageCircle className="w-4 h-4" /> Alerta Geral
                      </button>
                      <button 
                         onClick={() => setState(prev => ({ ...prev, drivers: prev.drivers.filter(d => d.id !== driver.id) }))}
                         className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition-colors"
                      >
                         Remover
                      </button>
                   </div>
                </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );
};
