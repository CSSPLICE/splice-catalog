import React, { useContext } from 'react';
import { Box } from '@adminjs/design-system';
import { SelectionPlacement, SLC_RESOURCE_ID } from './SelectionPlacement.jsx';

export default function SLCListDeleteSlot({ OriginalComponent, ...props }) {
  const placement = useContext(SelectionPlacement);
  if (!placement || props.resource.id !== SLC_RESOURCE_ID || props.actionName !== 'list') {
    return <OriginalComponent {...props} />;
  }

  // Breadcrumbs already occupy the header row containing the former resource-level button.
  return (
    <>
      <Box flexGrow={1} minWidth={0}>
        <OriginalComponent {...props} />
      </Box>
      <Box ref={placement.setTarget} flexShrink={0} ml="default" data-testid="slc-delete-selected-slot" />
    </>
  );
}
