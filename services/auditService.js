const AuditLog = require('../models/AuditLog');

/**
 * Audit Service
 * Centralized service for creating audit log entries
 * Makes it easy to log actions consistently across the application
 */

/**
 * Categories for audit logs
 */
const CATEGORIES = {
  AUTH: 'AUTH',
  ADMIN_ACTION: 'ADMIN_ACTION',
  ACCOUNT_CHANGE: 'ACCOUNT_CHANGE',
  SECURITY: 'SECURITY'
};

/**
 * Common actions (for consistency)
 */
const ACTIONS = {
  // Authentication
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  REGISTER: 'REGISTER',
  REGISTER_FAILED: 'REGISTER_FAILED',

  // Admin actions on users
  BAN_USER: 'BAN_USER',
  UNBAN_USER: 'UNBAN_USER',
  CREATE_USER: 'CREATE_USER',
  CREATE_SHARE_LINK: 'CREATE_SHARE_LINK',
  REVOKE_SHARE_LINK: 'REVOKE_SHARE_LINK',
  SETUP_ADMIN: 'SETUP_ADMIN',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  DELETE_USER: 'DELETE_USER',
  GRANT_ADMIN: 'GRANT_ADMIN',
  REVOKE_ADMIN: 'REVOKE_ADMIN',
  UPDATE_USER: 'UPDATE_USER',

  // Admin actions on URLs
  DELETE_URL: 'DELETE_URL',
  BLOCK_URL: 'BLOCK_URL',
  UNBLOCK_URL: 'UNBLOCK_URL',
  UPDATE_URL: 'UPDATE_URL',

  // Account changes
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  EMAIL_CHANGE: 'EMAIL_CHANGE',
  PROFILE_UPDATE: 'PROFILE_UPDATE',

  // Security
  REVIEW_REPORT: 'REVIEW_REPORT',
  DISMISS_REPORT: 'DISMISS_REPORT',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',
  EXPORT_AUDIT_LOGS: 'EXPORT_AUDIT_LOGS',

  // URL creation
  CREATE_URL: 'CREATE_URL',

  // Import/Export
  IMPORT_URLS: 'IMPORT_URLS',
  EXPORT_URLS: 'EXPORT_URLS',

  // System maintenance
  SYSTEM_MAINTENANCE: 'SYSTEM_MAINTENANCE',

  // Analytics Sharing
  SHARE_ANALYTICS: 'SHARE_ANALYTICS',
  REVOKE_ANALYTICS_SHARE: 'REVOKE_ANALYTICS_SHARE',
  UPDATE_ANALYTICS_SHARE: 'UPDATE_ANALYTICS_SHARE',
  VIEW_SHARED_ANALYTICS: 'VIEW_SHARED_ANALYTICS',

  // Bundle operations
  CREATE_BUNDLE: 'CREATE_BUNDLE',
  UPDATE_BUNDLE: 'UPDATE_BUNDLE',
  DELETE_BUNDLE: 'DELETE_BUNDLE',
  BLOCK_BUNDLE: 'BLOCK_BUNDLE',
  UNBLOCK_BUNDLE: 'UNBLOCK_BUNDLE',
  QUARANTINE_URL: 'QUARANTINE_URL',
  QUARANTINE_BUNDLE: 'QUARANTINE_BUNDLE',
  CLEAR_QUARANTINE: 'CLEAR_QUARANTINE',
  REVIEW_BUNDLE_REPORT: 'REVIEW_BUNDLE_REPORT',
  DISMISS_BUNDLE_REPORT: 'DISMISS_BUNDLE_REPORT',

  // File operations
  UPLOAD_FILE: 'UPLOAD_FILE',
  UPDATE_FILE: 'UPDATE_FILE',
  DELETE_FILE: 'DELETE_FILE',
  DOWNLOAD_FILE: 'DOWNLOAD_FILE',
  ADMIN_DELETE_FILE: 'ADMIN_DELETE_FILE',
  BLOCK_FILE: 'BLOCK_FILE',
  UNBLOCK_FILE: 'UNBLOCK_FILE',

  // Paste operations
  CREATE_PASTE: 'CREATE_PASTE',
  UPDATE_PASTE: 'UPDATE_PASTE',
  DELETE_PASTE: 'DELETE_PASTE',
  BLOCK_PASTE: 'BLOCK_PASTE',
  UNBLOCK_PASTE: 'UNBLOCK_PASTE',
  ADMIN_DELETE_PASTE: 'ADMIN_DELETE_PASTE',
};

/**
 * Log an audit entry
 * @param {Object} params - Log parameters
 * @param {Object} [params.req] - Express request object (auto-extracts user, IP, userAgent)
 * @param {number} [params.userId] - User ID (override req.user.id)
 * @param {string} [params.username] - Username (override req.user.username)
 * @param {string} params.action - Action performed (use ACTIONS constants)
 * @param {string} params.category - Category (use CATEGORIES constants)
 * @param {string} [params.targetType] - Type of target (user, url, report, etc.)
 * @param {number} [params.targetId] - ID of the affected resource
 * @param {string} [params.targetDescription] - Human-readable description
 * @param {Object} [params.details] - Additional details (will be JSON stringified)
 * @returns {Object} Created audit log entry
 */
function log({
  req,
  userId,
  username,
  action,
  category,
  targetType,
  targetId,
  targetDescription,
  details
}) {
  // Extract user info from request if available
  if (req && req.user) {
    userId = userId || req.user.id;
    username = username || req.user.username;
  }

  // Extract IP and user agent from request if available
  const ipAddress = req ? req.ip : null;
  const userAgent = req ? req.get('user-agent') : null;

  // Stringify details if it's an object
  const detailsString = details ? JSON.stringify(details) : null;

  return AuditLog.create({
    userId,
    username,
    action,
    category,
    targetType,
    targetId,
    targetDescription,
    ipAddress,
    userAgent,
    details: detailsString
  });
}

/**
 * Log authentication events
 */
function logAuth(action, req, username, details) {
  return log({
    req,
    username,
    action,
    category: CATEGORIES.AUTH,
    details
  });
}

/**
 * Log admin actions
 */
function logAdminAction(action, req, targetType, targetId, targetDescription, details) {
  return log({
    req,
    action,
    category: CATEGORIES.ADMIN_ACTION,
    targetType,
    targetId,
    targetDescription,
    details
  });
}

/**
 * Log account changes
 */
function logAccountChange(action, req, details) {
  return log({
    req,
    action,
    category: CATEGORIES.ACCOUNT_CHANGE,
    details
  });
}

/**
 * Log security events
 */
function logSecurity(action, req, targetType, targetId, targetDescription, details) {
  return log({
    req,
    action,
    category: CATEGORIES.SECURITY,
    targetType,
    targetId,
    targetDescription,
    details
  });
}

module.exports = {
  log,
  logAuth,
  logAdminAction,
  logAccountChange,
  logSecurity,
  CATEGORIES,
  ACTIONS
};
