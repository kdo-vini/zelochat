import React from 'react';
import { Camera, Check, ShieldCheck, LogOut } from 'lucide-react';
import { ZeloState } from '../../types';

export const ProfileView = ({ state, setState }: { state: ZeloState, setState: React.Dispatch<React.SetStateAction<ZeloState>> }) => (
  <div className="flex-1 min-h-0 overflow-y-auto p-8 pb-32 flex flex-col items-center justify-start space-y-8 custom-scrollbar">
     <div className="w-full max-w-2xl space-y-8">
        <header className="flex flex-col items-center text-center space-y-4">
           <div className="relative group">
              <div className="w-32 h-32 rounded-full border-4 border-[#00a884] p-1 shadow-2xl bg-white overflow-hidden">
                <img src={state.profile.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
              </div>
              <button className="absolute bottom-0 right-0 p-2 bg-[#00a884] text-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-4 h-4" />
              </button>
           </div>
           <div>
              <h2 className="text-2xl font-bold text-gray-800">{state.profile.name}</h2>
              <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
                <Check className="w-4 h-4 text-[#00a884]" /> {state.profile.role} • ZeloChat verificado
              </p>
           </div>
        </header>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                 <label className="text-[10px] font-bold text-gray-400 uppercase">Nome Completo</label>
                 <input 
                    type="text" 
                    value={state.profile.name}
                    onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, name: e.target.value } }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]" 
                 />
              </div>
              <div>
                 <label className="text-[10px] font-bold text-gray-400 uppercase">E-mail Administrativo</label>
                 <input 
                    type="email" 
                    value={state.profile.email}
                    onChange={(e) => setState(prev => ({ ...prev, profile: { ...prev.profile, email: e.target.value } }))}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]" 
                 />
              </div>
           </div>

           <div className="space-y-4">
              <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Ações de Conta</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <button className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-blue-400 transition-all gap-2 group">
                    <ShieldCheck className="w-6 h-6 text-blue-500" />
                    <span className="text-[10px] font-bold text-gray-600">Alterar Senha</span>
                 </button>
                 <button className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-orange-400 transition-all gap-2 group">
                    <LogOut className="w-6 h-6 text-orange-500" />
                    <span className="text-[10px] font-bold text-gray-600">Sair em outros disp.</span>
                 </button>
                 <button className="flex flex-col items-center justify-center p-4 bg-red-50 rounded-xl border border-red-100 hover:bg-red-100 transition-all gap-2 group">
                    <LogOut className="w-6 h-6 text-red-600" />
                    <span className="text-[10px] font-bold text-red-600">Encerrar Sessão</span>
                 </button>
              </div>
           </div>
        </div>

        <div className="flex justify-center gap-4 text-[10px] text-gray-400">
           <a href="#" className="hover:text-gray-600 transition-colors">Termos de Uso</a>
           <span>•</span>
           <a href="#" className="hover:text-gray-600 transition-colors">Política de Privacidade</a>
           <span>•</span>
           <span>Versão 1.4.2-beta</span>
        </div>
     </div>
  </div>
);
