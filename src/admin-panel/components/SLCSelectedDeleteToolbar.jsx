import React from 'react';
import { SLC_RESOURCE_ID } from './SelectionPlacement.jsx';

export default function SLCSelectedDeleteToolbar({ OriginalComponent, ...props }) {
  if (props.resource.id !== SLC_RESOURCE_ID) return <OriginalComponent {...props} />;

  // Filter only this rendering's buttons. Preserve the real selection, counter and other actions.
  const selectedRecords = props.selectedRecords?.map((record) => ({
    ...record,
    bulkActions: record.bulkActions.filter((action) => action.name !== 'bulkDelete'),
  }));
  return <OriginalComponent {...props} selectedRecords={selectedRecords} />;
}
