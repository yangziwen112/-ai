// 仅用于当前联调阶段。正式发布前必须将 enabled 改为 false。
module.exports = {
  autoAdminLogin: {
    enabled: true,
    sessionTtlMs: 6 * 60 * 60 * 1000,
    localUser: {
      userId: 'debug-admin-local',
      username: 'admin001',
      nickname: '调试管理员',
      role: 'admin',
      avatarUrl: '',
      isDebugAccount: true,
      cloudBound: false
    }
  }
}
