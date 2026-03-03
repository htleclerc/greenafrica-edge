@echo off
echo =========================================
echo Reorganizing and pushing to Git Remotes
echo =========================================

echo 1. Pushing everything to Mother Repo (origin)...
git push origin main

echo.
echo 2. Pushing frontend to Frontend Repo (origin-frontend)...
git subtree push --prefix frontend origin-frontend main

echo.
echo 3. Pushing backend to Backend Repo (origin-backend)...
git subtree push --prefix backend origin-backend main

echo.
echo =========================================
echo Push Completed!
echo =========================================
pause
