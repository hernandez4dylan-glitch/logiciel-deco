$racine = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $racine
$compteur = Join-Path $PSScriptRoot 'compteur.txt'
$n = 0; if (Test-Path $compteur) { $n = [int](Get-Content $compteur) }
$n++; Set-Content $compteur $n
if ($n -gt 40) { Remove-Item $compteur; exit 0 }
$erreurs = @()
foreach ($s in 'check','test','build') {
  $sortie = (cmd /c "npm run $s 2>&1") | Out-String
  if ($LASTEXITCODE -ne 0) { $erreurs += "npm run $s a echoue :`n" + $sortie.Substring([Math]::Max(0, $sortie.Length - 3000)) }
}
if (-not (Test-Path 'SUIVI.md')) { $erreurs += 'SUIVI.md est absent.' }
elseif (Select-String -Path 'SUIVI.md' -Pattern '- \[ \]' -Quiet) { $erreurs += 'Il reste des taches non cochees dans SUIVI.md.' }
if ($erreurs.Count -eq 0) { Remove-Item $compteur -ErrorAction SilentlyContinue; exit 0 }
@{ decision = 'block'; reason = ("Ne t'arrete pas, les criteres de fin ne sont pas remplis :`n`n" + ($erreurs -join "`n`n") + "`n`nCorrige et continue.") } | ConvertTo-Json -Compress
exit 0
