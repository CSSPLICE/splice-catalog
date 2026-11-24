import React, { useContext } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@adminjs/design-system';
import { useAction } from 'adminjs';
import { SelectionPlacement, SLC_RESOURCE_ID } from './SelectionPlacement.jsx';

function DeleteSelectedButton({ action, resourceId, recordIds }) {
  // This is the same action/navigation mechanism used by AdminJS's selection toolbar.
  const { handleClick } = useAction(action, { resourceId, recordIds });
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      disabled={!recordIds.length}
      onClick={handleClick}
      data-testid="slc-delete-selected"
    >
      Delete selected ({recordIds.length})
    </Button>
  );
}

export default function SLCSelectedDeleteTable({ OriginalComponent, ...props }) {
  const placement = useContext(SelectionPlacement);
  const original = <OriginalComponent {...props} />;
  if (props.resource.id !== SLC_RESOURCE_ID || !placement?.target) return original;

  // Consume the stock list's props directly; do not mirror IDs or checkbox state into context.
  const selected = props.selectedRecords || [];
  const action = selected.length
    ? selected.flatMap((record) => record.bulkActions).find((candidate) => candidate.name === 'bulkDelete')
    : props.resource.actions.find((candidate) => candidate.name === 'bulkDelete');
  const button = action ? (
    <DeleteSelectedButton
      action={action}
      resourceId={props.resource.id}
      recordIds={selected.map((record) => record.id)}
    />
  ) : (
    <Button type="button" variant="primary" size="sm" disabled data-testid="slc-delete-selected">
      Delete selected ({selected.length})
    </Button>
  );

  return (
    <>
      {original}
      {createPortal(button, placement.target)}
    </>
  );
}
