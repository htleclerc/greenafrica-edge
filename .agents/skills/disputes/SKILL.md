# Dispute Workflow Specialist

## Trigger
When working on dispute creation, resolution, evidence management, or arbitration workflows.

## Context
- Types: `Dispute`, `DisputeStatus`, `DisputeType` in `frontend/src/types/secure/index.ts`
- Hook: `frontend/src/hooks/useDisputes.ts`
- Page: `frontend/src/components/dashboard/disputes/DisputesPage.tsx`
- Form modal: `frontend/src/components/dashboard/disputes/DisputeFormModal.tsx`
- Mock data: `mockDisputes` in `frontend/src/mock/datas/secureMock.ts`

## Dispute Status Flow
```
DRAFT → SUBMITTED → UNDER_REVIEW → RESOLVED | REJECTED | ESCALATED
```

## Dispute Types
TAX_ASSESSMENT, COMPLIANCE_VIOLATION, INSPECTION_RESULT, BILLING_ERROR, EXEMPTION_DENIAL

## Rules
1. Only SHIPPING_AGENT, FLEET_MANAGER, LEGAL_REP can create disputes (shipowner side)
2. Only PORT_OFFICER, COMPLIANCE_AUDITOR can review/resolve disputes (port side)
3. FINANCE_ADMIN can view but not modify disputes
4. Evidence attachments must track file type and upload timestamp
5. Resolution must include a reason/justification text
6. Status transitions must follow the flow — no skipping steps
7. Escalated disputes go to a higher authority (SUPERADMIN or external)
