import React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { MoreHorizontal, Bike, Clock } from 'lucide-react';
import { ZeloState, Order } from '../../types';
import { STATUS_LABELS } from '../../constants';

type View = 'dashboard' | 'chat' | 'kanban' | 'calendar' | 'ai-configs' | 'settings' | 'profile' | 'drivers';

export const KanbanView = ({ state, onDragEnd, setActiveView }: { state: ZeloState, onDragEnd: (r: DropResult) => void, setActiveView: (v: View) => void }) => {
  const columns: Order['status'][] = ['pending', 'preparing', 'ready', 'delivered'];
  
  return (
    <div className="flex-1 min-h-0 flex flex-col p-8 space-y-6 relative">
      <header className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Fluxo de Pedidos (Kanban)</h2>
      </header>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 flex gap-6 overflow-x-auto pb-4 custom-scrollbar">
          {columns.map(col => (
            <Droppable key={col} droppableId={col}>
              {(provided) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="w-80 flex-shrink-0 flex flex-col h-full bg-gray-100/50 rounded-2xl border border-gray-200"
                >
                  <div className="p-4 flex justify-between items-center bg-white border-b border-gray-200 rounded-t-2xl">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">{STATUS_LABELS[col]}</h3>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-full">{state.orders.filter(o => o.status === col).length}</span>
                  </div>
                  <div className="flex-1 p-3 space-y-3 overflow-y-auto custom-scrollbar">
                    {state.orders.filter(o => o.status === col).map((order, index) => (
                      <React.Fragment key={order.id}>
                        <Draggable draggableId={order.id} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 cursor-pointer hover:border-[#00a884] transition-colors relative"
                            >
                              <div className="flex justify-between items-start mb-2">
                                <p className="text-sm font-bold text-gray-800">{order.customerName}</p>
                                
                                <div className="relative group">
                                  <MoreHorizontal className="w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600" />
                                  <div className="absolute right-0 top-5 bg-white shadow-xl border border-gray-100 rounded-lg p-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 min-w-[140px]">
                                    {col === 'ready' ? (
                                      <button 
                                        onClick={() => setActiveView('drivers')}
                                        className="w-full text-left px-3 py-2 text-xs font-bold text-orange-600 hover:bg-orange-50 rounded-md flex items-center gap-2"
                                      >
                                        <Bike className="w-3 h-3" /> Despachar Moto
                                      </button>
                                    ) : (
                                      <button className="w-full text-left px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-md">
                                        Ver Detalhes
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-1 mb-3">
                                {order.items.map((item, idx) => (
                                  <p key={idx} className="text-[11px] text-gray-500 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 bg-[#00a884] rounded-full" />
                                    {item.quantity}x {item.product}
                                  </p>
                                ))}
                              </div>
                              <div className="flex justify-between items-center pt-3 border-t border-gray-50 mt-2">
                                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                  <Clock className="w-3 h-3" /> {order.pickupTime}
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      </React.Fragment>
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
};
