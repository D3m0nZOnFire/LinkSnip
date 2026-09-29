const multer = require('multer');
const File = require('../models/File');
const RoleService = require('../services/roleService');
const configService = require('../services/configService');

const MB = 1024 * 1024;

/**
 * Per-file cap in bytes for this user, or null for none.
 * The role's maxFileSizeMB, capped by files.globalMaxFileSizeMB. A role limit of null
 * (the unlimited role, admins) bypasses the global cap too.
 */
function maxFileBytes(user) {
  const roleMB = RoleService.limit(user, 'maxFileSizeMB');
  if (roleMB === null) return null;
  const globalMB = configService.get('files.globalMaxFileSizeMB');
  return (globalMB === null ? roleMB : Math.min(roleMB, globalMB)) * MB;
}

/** Bytes left in the user's storage quota, or null for no quota. */
function remainingQuotaBytes(user) {
  const quotaMB = RoleService.limit(user, 'storageQuotaMB');
  if (quotaMB === null) return null;
  return Math.max(0, quotaMB * MB - File.totalSizeByUserId(user.id));
}

const formatMB = (bytes) => `${Math.round((bytes / MB) * 10) / 10} MB`;

/**
 * Multer for a single `file` field, built per request from the user's role, so the
 * size cap and quota apply without a restart. The byte limit is the smaller of the
 * size cap and the quota left, so an oversized upload is cut off while streaming
 * (multer removes the partial file).
 */
function fileUpload(storage) {
  return function uploadSingle(req, res, next) {
    const perFile = maxFileBytes(req.user);
    const remaining = remainingQuotaBytes(req.user);

    if (perFile === 0) {
      return res.status(403).json({ success: false, error: 'Your account is not allowed to upload files.' });
    }
    if (remaining === 0) {
      return res.status(413).json({ success: false, error: 'Your storage quota is full. Delete some files to upload more.' });
    }

    const quotaIsTighter = remaining !== null && (perFile === null || remaining < perFile);
    const limit = quotaIsTighter ? remaining : perFile;
    const limits = limit === null ? {} : { fileSize: limit };

    multer({ storage, limits }).single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: quotaIsTighter
            ? `This file would exceed your storage quota (${formatMB(remaining)} left).`
            : `File is too large (max ${formatMB(perFile)}).`
        });
      }
      return res.status(400).json({ success: false, error: err.message });
    });
  };
}

module.exports = { fileUpload, maxFileBytes, remainingQuotaBytes };
