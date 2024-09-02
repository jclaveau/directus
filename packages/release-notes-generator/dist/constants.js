"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSIONS_TITLE = exports.NOTICE_TYPE = exports.TYPE_MAP = exports.PACKAGE_ORDER = exports.UNTYPED_PACKAGES = exports.MAIN_PACKAGE = exports.REPO = void 0;
exports.REPO = 'directus/directus';
exports.MAIN_PACKAGE = 'directus';
exports.UNTYPED_PACKAGES = {
    docs: '📝 Documentation',
    'tests-blackbox': '🧪 Blackbox Tests',
};
exports.PACKAGE_ORDER = ['@directus/app', '@directus/api'];
exports.TYPE_MAP = {
    major: '⚠️ Potential Breaking Changes',
    minor: '✨ New Features & Improvements',
    patch: '🐛 Bug Fixes & Optimizations',
    none: '📎 Misc.',
};
exports.NOTICE_TYPE = exports.TYPE_MAP.major;
exports.VERSIONS_TITLE = '📦 Published Versions';
