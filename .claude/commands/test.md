Run the test suite and analyze results.

Steps:
1. Run unit tests: cd frontend && npm run test
2. If tests fail:
   - Analyze each failure
   - Read the failing test file and the source file it tests
   - Suggest specific fixes for each failure
3. If tests pass:
   - Report test count and pass rate
   - Run coverage if available: cd frontend && npm run test -- --coverage
   - Report coverage summary (statements, branches, functions, lines)
4. List test files and their status
5. Identify source files in frontend/src/lib/ and frontend/src/hooks/ that have no corresponding test files
