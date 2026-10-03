function createDriveStorage(options) {
  var settings = options || {};

  function getRoot() {
    if (settings.getRoot) return settings.getRoot();
    return DriveApp.getFolderById(getConfig().driveRootId);
  }

  function getChildFolder(name) {
    var matches = getRoot().getFoldersByName(name);
    if (!matches.hasNext()) return null;
    return matches.next();
  }

  function verifyFileExists(fileId) {
    try {
      var file = settings.getFileById ? settings.getFileById(fileId) : DriveApp.getFileById(fileId);
      return Boolean(file);
    } catch (error) {
      return false;
    }
  }

  function createChildFolder(name) {
    var existing = getChildFolder(name);
    if (existing) return { id: existing.getId(), name: existing.getName(), created: false };
    var created = getRoot().createFolder(name);
    return { id: created.getId(), name: created.getName(), created: true };
  }

  function readFileBytes(fileId) {
    var file = settings.getFileById ? settings.getFileById(fileId) : DriveApp.getFileById(fileId);
    if (!file || !file.getBlob) throw appError('NOT_FOUND', 'File was not found.');
    var blob = file.getBlob();
    return {
      mimeType: blob.getContentType(),
      bytes: blob.getBytes(),
      name: file.getName()
    };
  }

  function readFileMetadata(fileId) {
    var file = settings.getFileById ? settings.getFileById(fileId) : DriveApp.getFileById(fileId);
    if (!file) throw appError('NOT_FOUND', 'File was not found.');
    return { id: file.getId(), name: file.getName(), mimeType: file.getMimeType() };
  }

  function requireChild(name) {
    var folder = getChildFolder(name);
    if (!folder) throw appError('NOT_FOUND', 'Drive folder was not found.');
    return folder;
  }

  function uploadFile(folderName, blob, name) {
    var created = requireChild(folderName).createFile(blob);
    if (name) created.setName(name);
    return { id: created.getId(), name: created.getName() };
  }

  function replaceFile(fileId, blob, name) {
    var current = settings.getFileById ? settings.getFileById(fileId) : DriveApp.getFileById(fileId);
    if (!current) throw appError('NOT_FOUND', 'File was not found.');
    var parents = current.getParents();
    if (!parents.hasNext()) throw appError('NOT_FOUND', 'File parent was not found.');
    var created = parents.next().createFile(blob);
    created.setName(name || current.getName());
    current.setTrashed(true);
    return { id: created.getId(), name: created.getName() };
  }

  function deleteFile(fileId) {
    var current = settings.getFileById ? settings.getFileById(fileId) : DriveApp.getFileById(fileId);
    if (!current) throw appError('NOT_FOUND', 'File was not found.');
    current.setTrashed(true);
    return { id: current.getId(), trashed: true };
  }

  return {
    getRoot: getRoot,
    getChildFolder: getChildFolder,
    verifyFileExists: verifyFileExists,
    createChildFolder: createChildFolder,
    readFileBytes: readFileBytes,
    readFileMetadata: readFileMetadata,
    uploadFile: uploadFile,
    replaceFile: replaceFile,
    deleteFile: deleteFile
  };
}
