# 部署脚本 - 复制构建文件到 docs 目录
$source = "client\dist"
$destination = "docs"

if (Test-Path $source) {
    # 清空目标目录（保留 .git 文件夹）
    if (Test-Path $destination) {
        Get-ChildItem -Path $destination -Exclude ".git" | Remove-Item -Recurse -Force
    }
    
    # 复制所有文件
    Copy-Item -Path "$source\*" -Destination $destination -Recurse -Force
    Write-Host "文件已成功复制到 docs 目录"
} else {
    Write-Host "错误: 找不到 $source 目录"
    exit 1
}

