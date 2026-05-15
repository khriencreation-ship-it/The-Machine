import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export async function downloadTelegramFile(fileId: string): Promise<{ filePath: string, mimeType: string, fileName: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is missing")

  // 1. Get file path from Telegram
  const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const getFileData = await getFileRes.json()

  if (!getFileData.ok) {
    throw new Error(`Failed to get file info from Telegram: ${getFileData.description}`)
  }

  const telegramFilePath = getFileData.result.file_path
  const extension = path.extname(telegramFilePath) || '.bin'
  const fileName = `telegram_${randomUUID()}${extension}`
  
  // 2. Download the actual file
  const downloadRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`)
  if (!downloadRes.ok) {
    throw new Error(`Failed to download file from Telegram: ${downloadRes.statusText}`)
  }

  const buffer = Buffer.from(await downloadRes.arrayBuffer())

  // 3. Save to a temporary file
  const tempFilePath = path.join(os.tmpdir(), fileName)
  fs.writeFileSync(tempFilePath, buffer)

  // 4. Determine mimeType crudely based on extension (or let Gemini guess)
  let mimeType = 'application/octet-stream'
  if (extension === '.pdf') mimeType = 'application/pdf'
  else if (extension === '.png') mimeType = 'image/png'
  else if (extension === '.jpg' || extension === '.jpeg') mimeType = 'image/jpeg'
  else if (extension === '.mp4') mimeType = 'video/mp4'
  else if (extension === '.txt') mimeType = 'text/plain'
  else if (extension === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  return { filePath: tempFilePath, mimeType, fileName }
}
