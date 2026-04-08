Create a new React data hook at frontend/src/hooks/$ARGUMENTS.ts.

Follow the pattern of existing hooks (useVessels.ts, useDisputes.ts):

1. Read frontend/src/hooks/useVessels.ts as reference pattern
2. Import types from @/types/secure
3. Import mock data from @/mock/datas/secureMock
4. Use the useDataSource() pattern for mock/real data switching
5. Return typed data with loading/error states
6. Export the hook as named export
7. Add corresponding TypeScript types if needed in frontend/src/types/secure/index.ts

The hook should:
- Be fully typed (no `any`)
- Handle loading, error, and data states
- Support filtering/sorting if applicable
- Follow the camelCase naming convention (useMyHook)
