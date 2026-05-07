from pathlib import Path

p = Path('src/components/views/SettingsView.tsx')
src = p.read_text(encoding='utf-8')

start_marker = '        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">\n          <div className="space-y-5">\n            <SectionCard icon={Smartphone} title="Dados da empresa">'
horarios_start = '            <SectionCard icon={Clock} title="Horários e atendimento">'
horarios_end_pat = '            </SectionCard>\n\n          </div>\n\n          <div className="space-y-5">'
end_marker = '            <SectionCard icon={Shield} title="Segurança e dados">'

start_idx = src.find(start_marker)
assert start_idx != -1, "start marker not found"

horarios_start_idx = src.find(horarios_start, start_idx)
assert horarios_start_idx != -1, "horarios start not found"

horarios_end_idx = src.find(horarios_end_pat, horarios_start_idx)
assert horarios_end_idx != -1, "horarios end pattern not found"
horarios_block = src[horarios_start_idx:horarios_end_idx + len('            </SectionCard>')]

dados_start_idx = src.find('            <SectionCard icon={Smartphone} title="Dados da empresa">', start_idx)
dados_block = src[dados_start_idx:horarios_start_idx].rstrip() + '\n'

gerente_start_idx = src.find('            <SectionCard icon={UserCog} title="Gerente">')
assert gerente_start_idx != -1
gerente_end_pat = '            </SectionCard>\n\n            <SectionCard icon={Shield}'
gerente_end_idx = src.find(gerente_end_pat, gerente_start_idx)
assert gerente_end_idx != -1
gerente_block = src[gerente_start_idx:gerente_end_idx + len('            </SectionCard>')]

seg_start_idx = src.find(end_marker)
assert seg_start_idx != -1
grid_end_pat = '            </SectionCard>\n          </div>\n        </div>'
grid_end_idx = src.find(grid_end_pat, seg_start_idx)
assert grid_end_idx != -1
grid_end_full = grid_end_idx + len(grid_end_pat)

new_block = '''        <div className="space-y-8">
          <TierGroup
            label="Operação"
            description="Status do sistema e atendimento — muda no dia-a-dia."
          >
            <WhatsAppIntegrationCard
              token={token}
              subscriptionActive={subscriptionActive}
              subscriptionLoading={subscriptionLoading}
              subscription={subscription}
              hasPdvOnly={hasPdvOnly}
              onPlanChange={handlePlanChange}
            />

            <AiGlobalToggleCard token={token} />

''' + horarios_block + '''
          </TierGroup>

          <TierGroup
            label="Negócio"
            description="Como sua lanchonete aparece pro cliente."
          >
''' + dados_block + '''
            <CustomerNotificationsCard empresa={empresa} saveEmpresa={saveEmpresa} isAuthenticated={isAuthenticated} />

            <DeliveryConfigCard state={state} setState={setState} saveEmpresa={saveEmpresa} isAuthenticated={isAuthenticated} />

''' + gerente_block + '''
          </TierGroup>
        </div>'''

new_src = src[:start_idx] + new_block + src[grid_end_full:]
p.write_text(new_src, encoding='utf-8')
print(f"Done. File size: {len(new_src)} chars")
