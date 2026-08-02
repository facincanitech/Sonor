Copy-Item index.html www\index.html -Force
Copy-Item version.json www\version.json -Force -ErrorAction SilentlyContinue
npx cap sync android
Write-Host "Pronto — rebuilda no Android Studio."
