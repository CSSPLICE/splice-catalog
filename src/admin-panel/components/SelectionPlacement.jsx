import React, { createContext, useMemo, useState } from 'react';

export const SLC_RESOURCE_ID = 'slc_item_catalog';

// Share only a React-managed destination. AdminJS remains the sole owner of selection state.
export const SelectionPlacement = createContext(null);

export default function SelectionPlacementProvider({ OriginalComponent, ...props }) {
  const [target, setTarget] = useState(null);
  const placement = useMemo(() => ({ target, setTarget }), [target]);

  return (
    <SelectionPlacement.Provider value={placement}>
      <OriginalComponent {...props} />
    </SelectionPlacement.Provider>
  );
}
