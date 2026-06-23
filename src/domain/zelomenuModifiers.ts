export type ZeloMenuModifierGroupKind = 'adicional' | 'variacao';

export type ZeloMenuModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
  order: number;
};

export type ZeloMenuModifierGroup = {
  id: string;
  productId: number;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  minSelections: number;
  maxSelections: number | null;
  active: boolean;
  order: number;
  options: ZeloMenuModifierOption[];
};

export type ZeloMenuModifierOptionDraft = {
  id?: string;
  name: string;
  priceDelta: number;
  active: boolean;
  order: number;
};

export type ZeloMenuModifierGroupDraft = {
  id?: string;
  name: string;
  kind: ZeloMenuModifierGroupKind;
  minSelections: number;
  maxSelections: number | null;
  active: boolean;
  order: number;
  options: ZeloMenuModifierOptionDraft[];
};

export type ZeloMenuModifierSelectionInput = {
  groupId: string;
  optionIds: string[];
};

export type ZeloMenuSelectedModifierOption = {
  optionId: string;
  optionName: string;
  priceDelta: number;
};

export type ZeloMenuSelectedModifierGroup = {
  groupId: string;
  groupName: string;
  kind: ZeloMenuModifierGroupKind;
  selectedOptions: ZeloMenuSelectedModifierOption[];
};

export type ZeloMenuModifierResolutionErrorCode =
  | 'group_missing'
  | 'option_missing'
  | 'group_required'
  | 'selection_bounds';

export type ZeloMenuModifierResolutionResult =
  | {
      ok: true;
      selectedGroups: ZeloMenuSelectedModifierGroup[];
      deltaTotal: number;
    }
  | {
      ok: false;
      code: ZeloMenuModifierResolutionErrorCode;
      message: string;
    };

export type ModifierAwareCartItem = {
  productName: string;
  selectedModifiers?: ZeloMenuSelectedModifierGroup[] | null;
};

export function sortModifierGroups(groups: ZeloMenuModifierGroup[]): ZeloMenuModifierGroup[] {
  return [...groups]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      options: [...group.options].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    }));
}

export function buildModifierSelectionKey(selections: ZeloMenuModifierSelectionInput[] | null | undefined): string {
  if (!selections || selections.length === 0) return 'plain';
  return selections
    .map((selection) => ({
      groupId: selection.groupId,
      optionIds: [...new Set(selection.optionIds)].sort(),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId))
    .map((selection) => `${selection.groupId}:${selection.optionIds.join(',')}`)
    .join('|');
}

export function resolveModifierSelections(
  groups: ZeloMenuModifierGroup[] | null | undefined,
  selections: ZeloMenuModifierSelectionInput[] | null | undefined,
): ZeloMenuModifierResolutionResult {
  const activeGroups = sortModifierGroups((groups ?? []).filter((group) => group.active));
  if (activeGroups.length === 0) {
    return { ok: true, selectedGroups: [], deltaTotal: 0 };
  }

  const selectionsByGroupId = new Map<string, string[]>();
  for (const selection of selections ?? []) {
    const uniqueOptionIds = [...new Set(selection.optionIds.filter((optionId) => typeof optionId === 'string' && optionId.trim()))];
    selectionsByGroupId.set(selection.groupId, uniqueOptionIds);
  }

  for (const selection of selections ?? []) {
    const knownGroup = activeGroups.find((group) => group.id === selection.groupId);
    if (!knownGroup) {
      return {
        ok: false,
        code: 'group_missing',
        message: 'Um grupo de adicionais desse item não está mais disponível.',
      };
    }
  }

  const selectedGroups: ZeloMenuSelectedModifierGroup[] = [];
  let deltaTotal = 0;

  for (const group of activeGroups) {
    const optionIds = selectionsByGroupId.get(group.id) ?? [];
    const activeOptions = group.options.filter((option) => option.active);
    const selectedOptions: ZeloMenuSelectedModifierOption[] = [];

    for (const optionId of optionIds) {
      const option = activeOptions.find((candidate) => candidate.id === optionId);
      if (!option) {
        return {
          ok: false,
          code: 'option_missing',
          message: `Uma opção de ${group.name} não está mais disponível.`,
        };
      }
      selectedOptions.push({
        optionId: option.id,
        optionName: option.name,
        priceDelta: roundCurrency(option.priceDelta),
      });
      deltaTotal += roundCurrency(option.priceDelta);
    }

    if (selectedOptions.length < group.minSelections) {
      return {
        ok: false,
        code: 'group_required',
        message: `Escolha ${selectionCountLabel(group.minSelections)} em ${group.name}.`,
      };
    }

    if (group.maxSelections != null && selectedOptions.length > group.maxSelections) {
      return {
        ok: false,
        code: 'selection_bounds',
        message: `Você pode escolher no máximo ${selectionCountLabel(group.maxSelections)} em ${group.name}.`,
      };
    }

    if (selectedOptions.length > 0) {
      selectedGroups.push({
        groupId: group.id,
        groupName: group.name,
        kind: group.kind,
        selectedOptions,
      });
    }
  }

  return {
    ok: true,
    selectedGroups,
    deltaTotal: roundCurrency(deltaTotal),
  };
}

export function formatSelectedModifierGroups(
  selectedGroups: ZeloMenuSelectedModifierGroup[] | null | undefined,
): string {
  if (!selectedGroups || selectedGroups.length === 0) return '';
  return selectedGroups
    .map((group) => {
      const options = group.selectedOptions.map((option) => option.optionName).join(', ');
      return `${group.groupName}: ${options}`;
    })
    .join(' • ');
}

export function formatModifierAwareCartItem(item: ModifierAwareCartItem): string {
  const summary = formatSelectedModifierGroups(item.selectedModifiers);
  return summary ? `${item.productName} (${summary})` : item.productName;
}

export function validateModifierGroupDrafts(groups: ZeloMenuModifierGroupDraft[]): string | null {
  for (const group of groups) {
    if (!group.name.trim()) return 'Todo grupo precisa de um nome.';
    if (group.minSelections < 0) return `O grupo ${group.name} tem mínimo inválido.`;
    if (group.maxSelections != null && group.maxSelections < Math.max(group.minSelections, 1)) {
      return `O grupo ${group.name} precisa de um máximo maior ou igual ao mínimo.`;
    }
    if (group.options.length === 0) {
      return `O grupo ${group.name} precisa ter pelo menos uma opção.`;
    }

    let activeOptions = 0;
    for (const option of group.options) {
      if (!option.name.trim()) return `Uma opção do grupo ${group.name} está sem nome.`;
      if (!Number.isFinite(option.priceDelta) || option.priceDelta < 0) {
        return `A opção ${option.name || 'sem nome'} do grupo ${group.name} tem preço adicional inválido.`;
      }
      if (option.active) activeOptions += 1;
    }

    if (group.active && activeOptions < group.minSelections) {
      return `O grupo ${group.name} precisa de pelo menos ${selectionCountLabel(group.minSelections)} ativa(s).`;
    }
  }
  return null;
}

function selectionCountLabel(value: number): string {
  return `${value} ${value === 1 ? 'opção' : 'opções'}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
