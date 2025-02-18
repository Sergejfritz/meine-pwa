const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,  // Für den schnellen Einstieg – in Produktionsapps sollte dies sicherer konfiguriert werden.
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// IPC-Listener: PDF-Daten empfangen und im gewünschten Pfad speichern
ipcMain.on('save-pdf', (event, pdfDataUri) => {
  // Entferne den Data-URI-Header
  const base64Data = pdfDataUri.replace(/^data:application\/pdf;base64,/, '');
  const filePath = 'C:\\Users\\Sergej\\Desktop\\app\\Dokument_' + new Date().toISOString().slice(0,10) + '.pdf';
  fs.writeFile(filePath, base64Data, 'base64', (err) => {
    if (err) {
      event.sender.send('save-pdf-response', { success: false, error: err.message });
    } else {
      event.sender.send('save-pdf-response', { success: true, path: filePath });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
