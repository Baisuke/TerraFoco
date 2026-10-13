param([string]$Entrada, [string]$Salida, [string]$Pdf)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($Entrada, $false, $false)
    # Paginación completa antes de rellenar el índice
    $doc.Repaginate()
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
    $doc.Repaginate()
    foreach ($toc in $doc.TablesOfContents) { $toc.UpdatePageNumbers() }
    $doc.SaveAs2($Salida, 16)          # wdFormatDocumentDefault
    $paginas = $doc.ComputeStatistics(2)   # wdStatisticPages
    $doc.ExportAsFixedFormat($Pdf, 17)     # wdExportFormatPDF
    $doc.Close($false)
    Write-Output "paginas: $paginas"
} finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
