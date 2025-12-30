/* ============================================
   Nyx Studio - 工具函数库 (Supabase 版本)
   ============================================ */

// ============ 颜色常量 ============
const colors = {
  bg: '#0a0a12',
  bgLight: '#12121f',
  bgCard: '#1a1a2e',
  bgHover: '#252540',
  primary: '#9d4edd',
  primaryLight: '#c77dff',
  accent: '#ffd700',
  accentDark: '#b8860b',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  border: '#2d2d44',
  normalOrder: '#3b82f6',
  giftOrder: '#ec4899',
  monthlyOrder: '#10b981',
  prepaidOrder: '#f59e0b',
  bonus: '#ffd700'
};

// ============ 日期工具函数 ============
function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
  return formatDate(new Date());
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

function getMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// ============ 订单类型工具函数 ============
function getOrderTypeColor(type) {
  switch (type) {
    case 'normal': return colors.normalOrder;
    case 'gift': return colors.giftOrder;
    case 'monthly': return colors.monthlyOrder;
    case 'prepaid': return colors.prepaidOrder;
    case 'deduct_prepaid': return colors.warning;
    case 'bonus': return colors.bonus;
    default: return colors.primary;
  }
}

function getOrderTypeName(type) {
  switch (type) {
    case 'normal': return '正常单';
    case 'gift': return '礼物单';
    case 'monthly': return '月卡单';
    case 'prepaid': return '预存单';
    case 'deduct_prepaid': return '扣除存单';
    case 'bonus': return '奖金';
    default: return type;
  }
}

function getOrderTypeBgColor(type) {
  const color = getOrderTypeColor(type);
  return `${color}15`;
}

// ============ 提成计算函数 ============
function calculateCommission(order, receptionist) {
  if (order.type === 'monthly') return 0;
  if (order.type === 'deduct_prepaid') return 0;
  if (order.type === 'bonus') return order.amount;
  const rate = receptionist.commission_expiry && new Date(receptionist.commission_expiry) > new Date()
    ? receptionist.commission_rate
    : (order.type === 'normal' ? 5 : order.type === 'gift' ? 10 : 5);
  return order.amount * (rate / 100);
}

// 计算工作室收入（新计费规则）
// 特殊规则：当占卜师为"虎虎"时，工作室收入为0（虎虎拿剩余金额）
function calculateStudioIncomeForOrder(order) {
  // 虎虎接单时工作室不收取费用
  if (order.divinerId === '虎虎') {
    return 0;
  }
  
  switch (order.type) {
    case 'normal': return order.amount * 0.25;
    case 'gift': return order.amount * 0.10;
    case 'monthly': return 9.9;
    case 'prepaid': return order.amount * 0.25;
    case 'deduct_prepaid': return 0;
    case 'bonus': return 0;
    default: return 0;
  }
}

// 计算工作室总收入
function calculateTotalStudioIncome(orders) {
  return orders.filter(o => o.approved !== false).reduce((sum, o) => sum + calculateStudioIncomeForOrder(o), 0);
}

// ============ 老板预存系统 ============
async function getBossBalance(bossName) {
  const orders = await DataStore.getOrders();
  const bossOrders = orders.filter(o => o.boss_name === bossName && o.approved !== false);

  const totalPrepaid = bossOrders
    .filter(o => o.type === 'prepaid')
    .reduce((sum, o) => sum + (o.amount || 0), 0);

  const totalDeducted = bossOrders
    .filter(o => o.type === 'deduct_prepaid')
    .reduce((sum, o) => sum + (o.amount || 0), 0);

  return totalPrepaid - totalDeducted;
}

// 同步版本 - 用于已有数据的计算
function getBossBalanceSync(bossName, orders) {
  const bossOrders = orders.filter(o => o.boss_name === bossName && o.approved !== false);

  const totalPrepaid = bossOrders
    .filter(o => o.type === 'prepaid')
    .reduce((sum, o) => sum + (o.amount || 0), 0);

  const totalDeducted = bossOrders
    .filter(o => o.type === 'deduct_prepaid')
    .reduce((sum, o) => sum + (o.amount || 0), 0);

  return totalPrepaid - totalDeducted;
}

// 检查是否是周日21点后
function isAfterSundayDeadline() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  return day === 0 && hour >= 21;
}

// ============ Supabase 数据存储管理 ============
const DataStore = {
  // ============ 用户/接待员 ============
  async getReceptionists() {
    const { data, error } = await supabaseClient
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching users:', error);
      return [];
    }

    // 转换字段名以兼容旧代码
    return data.map(u => ({
      id: u.id,
      name: u.name,
      emoji: u.emoji,
      role: u.role,
      password: u.password,
      balance: 0,
      isIntern: u.is_intern,
      commissionRate: u.commission_rate,
      commissionExpiry: u.commission_expiry,
      isDeleted: u.is_deleted,
      lastSettlementDate: u.last_settlement_date,
      backupSettlementDate: u.backup_settlement_date,
      // 保留原始字段用于数据库操作
      _raw: u
    }));
  },

  async saveReceptionist(receptionist) {
    const dbData = {
      name: receptionist.name,
      emoji: receptionist.emoji,
      role: receptionist.role,
      password: receptionist.password,
      is_intern: receptionist.isIntern,
      commission_rate: receptionist.commissionRate,
      commission_expiry: receptionist.commissionExpiry,
      is_deleted: receptionist.isDeleted,
      last_settlement_date: receptionist.lastSettlementDate,
      backup_settlement_date: receptionist.backupSettlementDate
    };

    if (receptionist.id) {
      const { data, error } = await supabaseClient
        .from('users')
        .update(dbData)
        .eq('id', receptionist.id)
        .select();

      if (error) {
        console.error('Error updating user:', error);
        return null;
      }
      return data[0];
    } else {
      const { data, error } = await supabaseClient
        .from('users')
        .insert(dbData)
        .select();

      if (error) {
        console.error('Error inserting user:', error);
        return null;
      }
      return data[0];
    }
  },

  async updateReceptionist(id, updates) {
    const dbUpdates = {};
    if (updates.isIntern !== undefined) dbUpdates.is_intern = updates.isIntern;
    if (updates.commissionRate !== undefined) dbUpdates.commission_rate = updates.commissionRate;
    if (updates.commissionExpiry !== undefined) dbUpdates.commission_expiry = updates.commissionExpiry;
    if (updates.isDeleted !== undefined) dbUpdates.is_deleted = updates.isDeleted;
    if (updates.lastSettlementDate !== undefined) dbUpdates.last_settlement_date = updates.lastSettlementDate;
    if (updates.backupSettlementDate !== undefined) dbUpdates.backup_settlement_date = updates.backupSettlementDate;
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.emoji !== undefined) dbUpdates.emoji = updates.emoji;
    if (updates.password !== undefined) dbUpdates.password = updates.password;

    const { data, error } = await supabaseClient
      .from('users')
      .update(dbUpdates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error updating user:', error);
      return null;
    }
    return data[0];
  },

  async deleteReceptionist(id, keepOrders = true) {
    if (keepOrders) {
      // 软删除
      return await this.updateReceptionist(id, { isDeleted: true });
    } else {
      // 硬删除 (会级联删除订单)
      const { error } = await supabaseClient
        .from('users')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting user:', error);
        return false;
      }
      return true;
    }
  },

  // ============ 订单 ============
  async getOrders() {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching orders:', error);
      return [];
    }

    // 转换字段名以兼容旧代码
    return data.map(o => ({
      id: o.id,
      receptionistId: o.receptionist_id,
      bossName: o.boss_name,
      boss_name: o.boss_name, // 保留两种命名
      divinerId: o.diviner_id,
      type: o.type,
      amount: parseFloat(o.amount) || 0,
      questionContent: o.question_content,
      bonusType: o.bonus_type,
      approved: o.approved,
      date: o.date,
      createdAt: o.created_at,
      _raw: o
    }));
  },

  async saveOrder(order) {
    const dbData = {
      receptionist_id: order.receptionistId,
      boss_name: order.bossName,
      diviner_id: order.divinerId || null,
      type: order.type,
      amount: order.amount || 0,
      question_content: order.questionContent || null,
      bonus_type: order.bonusType || null,
      approved: order.approved !== undefined ? order.approved : false,
      date: order.date
    };

    const { data, error } = await supabaseClient
      .from('orders')
      .insert(dbData)
      .select();

    if (error) {
      console.error('Error inserting order:', error);
      return null;
    }
    return data[0];
  },

  async updateOrder(id, updates) {
    const dbUpdates = {};
    if (updates.approved !== undefined) dbUpdates.approved = updates.approved;
    if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
    if (updates.bossName !== undefined) dbUpdates.boss_name = updates.bossName;
    if (updates.divinerId !== undefined) dbUpdates.diviner_id = updates.divinerId;
    if (updates.questionContent !== undefined) dbUpdates.question_content = updates.questionContent;

    const { data, error } = await supabaseClient
      .from('orders')
      .update(dbUpdates)
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error updating order:', error);
      return null;
    }
    return data[0];
  },

  async deleteOrder(id) {
    const { error } = await supabaseClient
      .from('orders')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting order:', error);
      return false;
    }
    return true;
  },

  async approveOrder(id) {
    return await this.updateOrder(id, { approved: true });
  },

  // ============ 惩罚 ============
  async getPenalties() {
    const { data, error } = await supabaseClient
      .from('penalties')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching penalties:', error);
      return [];
    }

    return data.map(p => ({
      id: p.id,
      receptionistId: p.receptionist_id,
      amount: parseFloat(p.amount) || 0,
      reason: p.reason,
      date: p.date,
      createdAt: p.created_at
    }));
  },

  async getPenaltiesByReceptionist(receptionistId) {
    const { data, error } = await supabaseClient
      .from('penalties')
      .select('*')
      .eq('receptionist_id', receptionistId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching penalties:', error);
      return [];
    }

    return data.map(p => ({
      id: p.id,
      receptionistId: p.receptionist_id,
      amount: parseFloat(p.amount) || 0,
      reason: p.reason,
      date: p.date,
      createdAt: p.created_at
    }));
  },

  async savePenalty(penalty) {
    const dbData = {
      receptionist_id: penalty.receptionistId,
      amount: penalty.amount,
      reason: penalty.reason,
      date: penalty.date
    };

    const { data, error } = await supabaseClient
      .from('penalties')
      .insert(dbData)
      .select();

    if (error) {
      console.error('Error inserting penalty:', error);
      return null;
    }
    return data[0];
  },

  async deletePenalty(id) {
    const { error } = await supabaseClient
      .from('penalties')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting penalty:', error);
      return false;
    }
    return true;
  },

  // ============ 公告 ============
  async getAnnouncements() {
    const { data, error } = await supabaseClient
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching announcements:', error);
      return [];
    }

    return data.map(a => ({
      id: a.id,
      content: a.content,
      createdAt: a.created_at
    }));
  },

  async saveAnnouncement(content) {
    const { data, error } = await supabaseClient
      .from('announcements')
      .insert({ content })
      .select();

    if (error) {
      console.error('Error inserting announcement:', error);
      return null;
    }
    return data[0];
  },

  async deleteAnnouncement(id) {
    const { error } = await supabaseClient
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting announcement:', error);
      return false;
    }
    return true;
  },

  // ============ 已读公告 ============
  async getReadAnnouncements(userId) {
    const { data, error } = await supabaseClient
      .from('read_announcements')
      .select('announcement_id')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching read announcements:', error);
      return [];
    }

    return data.map(r => r.announcement_id);
  },

  async markAnnouncementRead(userId, announcementId) {
    const { error } = await supabaseClient
      .from('read_announcements')
      .upsert({
        user_id: userId,
        announcement_id: announcementId
      }, {
        onConflict: 'user_id,announcement_id'
      });

    if (error) {
      console.error('Error marking announcement read:', error);
      return false;
    }
    return true;
  },

  // ============ 周结算 ============
  async getSettledIds() {
    const weekStart = formatDate(getWeekStart());

    const { data, error } = await supabaseClient
      .from('weekly_settlements')
      .select('receptionist_id')
      .eq('week_start', weekStart)
      .eq('is_settled', true);

    if (error) {
      console.error('Error fetching settled ids:', error);
      return [];
    }

    return data.map(s => s.receptionist_id);
  },

  async setSettled(receptionistId, isSettled) {
    const weekStart = formatDate(getWeekStart());

    const { data, error } = await supabaseClient
      .from('weekly_settlements')
      .upsert({
        receptionist_id: receptionistId,
        week_start: weekStart,
        is_settled: isSettled,
        settled_at: isSettled ? new Date().toISOString() : null
      }, {
        onConflict: 'receptionist_id,week_start'
      })
      .select();

    if (error) {
      console.error('Error setting settlement:', error);
      return null;
    }
    return data[0];
  },

  // ============ 当前用户 (仍使用 sessionStorage) ============
  getCurrentUser() {
    const saved = sessionStorage.getItem('nyx_current_user');
    return saved ? JSON.parse(saved) : null;
  },

  setCurrentUser(user) {
    if (user) {
      sessionStorage.setItem('nyx_current_user', JSON.stringify(user));
    } else {
      sessionStorage.removeItem('nyx_current_user');
    }
  }
};

// ============ 计算接待余额 ============
async function calculateBalance(receptionistId) {
  const receptionists = await DataStore.getReceptionists();
  const orders = await DataStore.getOrders();
  const penalties = await DataStore.getPenaltiesByReceptionist(receptionistId);

  const receptionist = receptionists.find(r => r.id === receptionistId);

  if (!receptionist) {
    return { amount: 0, taskFailed: false };
  }

  const lastSettlementTime = receptionist.lastSettlementDate ? new Date(receptionist.lastSettlementDate).getTime() : 0;

  const userOrders = orders.filter(o =>
    o.receptionistId === receptionistId &&
    o.approved !== false &&
    new Date(o.createdAt).getTime() > lastSettlementTime
  );

  let balance = 0;
  userOrders.forEach(order => {
    if (order.type === 'bonus') {
      balance += order.amount;
    } else if (order.type !== 'monthly') {
      balance += calculateCommission(order, receptionist);
    }
  });

  // 减去惩罚
  penalties.forEach(p => {
    const penaltyTime = p.createdAt ? new Date(p.createdAt).getTime() : new Date(p.date).getTime();
    if (penaltyTime > lastSettlementTime) {
      balance -= p.amount;
    }
  });

  // 检查周任务
  const weekStart = getWeekStart().getTime();
  const taskStartTime = Math.max(weekStart, lastSettlementTime);

  const weekOrders = userOrders.filter(o => {
    const orderTime = new Date(o.createdAt).getTime();
    return orderTime >= taskStartTime && o.type === 'monthly';
  });

  const taskCompleted = weekOrders.length >= 3;

  if (isAfterSundayDeadline() && !taskCompleted) {
    return { amount: 0, taskFailed: true };
  }

  if (taskCompleted) {
    const baseSalary = receptionist.isIntern ? 20 : 40;
    balance += baseSalary;
  }

  return { amount: Math.round(balance * 100) / 100, taskFailed: false };
}

// ============ 登录/注册处理 ============
async function handleLogin(username, password) {
  const receptionists = await DataStore.getReceptionists();
  const normalizedUsername = username.trim();

  // 管理者登录检查
  const isManager = normalizedUsername === '管理者' ||
    normalizedUsername === '管理员' ||
    normalizedUsername.toLowerCase() === 'manager' ||
    normalizedUsername.toLowerCase() === 'admin';

  const user = receptionists.find(r => r.name === normalizedUsername && (r.role === 'manager' || !r.isDeleted));

  if (!user) {
    return { success: false, message: '未注册名字，请先注册哦宝宝。' };
  }
  if (user.password !== password) {
    return { success: false, message: '密码不正确宝宝qnq 请重新输入。\n忘记密码请联系运营。' };
  }

  DataStore.setCurrentUser(user);
  return { success: true, user };
}

async function handleRegister(name, emoji, password) {
  const receptionists = await DataStore.getReceptionists();

  if (receptionists.find(r => r.name === name)) {
    return { success: false, message: '该名称已被注册哦～' };
  }

  const newUser = {
    name,
    emoji,
    password,
    role: 'receptionist',
    isIntern: true,
    commissionRate: 5,
    commissionExpiry: null,
    isDeleted: false
  };

  const savedUser = await DataStore.saveReceptionist(newUser);

  if (!savedUser) {
    return { success: false, message: '注册失败，请稍后重试。' };
  }

  const userWithId = {
    ...newUser,
    id: savedUser.id
  };

  DataStore.setCurrentUser(userWithId);
  return { success: true, user: userWithId };
}

// ============ 订单处理 ============
async function submitOrder(orderData) {
  const user = DataStore.getCurrentUser();

  const newOrder = {
    ...orderData,
    receptionistId: user.id,
    approved: false
  };

  const savedOrder = await DataStore.saveOrder(newOrder);

  if (!savedOrder) {
    return { success: false, message: '提交失败，请稍后重试。' };
  }

  return { success: true, order: savedOrder };
}

// ============ 星星背景生成 ============
function createStars(container) {
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 50; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.width = `${Math.random() * 3 + 1}px`;
    star.style.height = star.style.width;
    star.style.animation = `twinkle ${Math.random() * 2 + 2}s ease-in-out ${Math.random() * 3}s infinite`;
    fragment.appendChild(star);
  }

  container.appendChild(fragment);
}

// ============ 删除小猫按钮 SVG ============
function createDeleteCatSVG() {
  return `
    <svg width="32" height="32" viewBox="0 0 100 100" style="pointer-events: none;">
      <ellipse cx="50" cy="55" rx="30" ry="25" fill="#ffb6c1" stroke="#333" stroke-width="2"/>
      <polygon points="25,35 15,10 40,30" fill="#ffb6c1" stroke="#333" stroke-width="2"/>
      <polygon points="28,32 22,18 36,30" fill="#ffc0cb"/>
      <polygon points="75,35 85,10 60,30" fill="#ffb6c1" stroke="#333" stroke-width="2"/>
      <polygon points="72,32 78,18 64,30" fill="#ffc0cb"/>
      <line x1="32" y1="45" x2="42" y2="55" stroke="#333" stroke-width="3" stroke-linecap="round"/>
      <line x1="42" y1="45" x2="32" y2="55" stroke="#333" stroke-width="3" stroke-linecap="round"/>
      <line x1="58" y1="45" x2="68" y2="55" stroke="#333" stroke-width="3" stroke-linecap="round"/>
      <line x1="68" y1="45" x2="58" y2="55" stroke="#333" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="50" cy="62" rx="4" ry="3" fill="#ff69b4"/>
      <path d="M 42 68 Q 50 75 58 68" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="58" x2="35" y2="60" stroke="#333" stroke-width="1.5"/>
      <line x1="20" y1="65" x2="35" y2="65" stroke="#333" stroke-width="1.5"/>
      <line x1="65" y1="60" x2="80" y2="58" stroke="#333" stroke-width="1.5"/>
      <line x1="65" y1="65" x2="80" y2="65" stroke="#333" stroke-width="1.5"/>
    </svg>
  `;
}

// ============ Emoji 数据 ============
const emojiCategories = {
  '😊 表情': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬'],
  '🌸 自然': ['🌸', '🌺', '🌻', '🌼', '🌷', '🌹', '🥀', '💐', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🌵', '🌴', '🌳', '🌲', '🎋', '🎍', '🌱', '🪴', '🌏', '🌍', '🌎', '🌕', '🌙', '🌛', '🌜', '⭐', '🌟', '✨', '💫', '☀️', '🌈', '☁️', '❄️', '🔥', '💧'],
  '🦋 动物': ['🦋', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🐌', '🐞', '🐜', '🦗', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐'],
  '🍎 食物': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🧀', '🥚', '🍳', '🥞', '🧇', '🍰', '🎂'],
  '🎮 活动': ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🎯', '🎳', '🎮', '🎲', '🧩', '🎭', '🎨', '🎬', '🎤', '🎧', '🎷', '🎸', '🎹', '🥁', '🎺', '🎻', '🏆', '🥇', '🥈', '🥉', '🎖️', '🏅', '🎪', '🎟️', '🎫', '🎁', '🎀', '🎊', '🎉', '🎈', '🪅'],
  '💎 物品': ['💎', '💍', '👑', '👒', '🎩', '🧢', '👓', '🕶️', '🌂', '👜', '👛', '👝', '🎒', '💼', '📱', '💻', '⌨️', '🖥️', '📷', '📸', '📹', '🎥', '📺', '📻', '⏰', '🕰️', '⌛', '📡', '🔋', '💡', '🔦', '🕯️', '🔮', '🧿', '💌', '📦', '📫', '✏️', '📝', '📚'],
  '❤️ 符号': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '☯️', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '⛎']
};

// 正常单允许的金额列表
const allowedNormalAmounts = [119, 165, 198, 99, 98, 135, 388, 350, 310, 680, 190, 223, 253];

// 扣除存单允许的金额列表
const allowedDeductAmounts = [98, 99, 119, 135, 165, 190, 198, 223, 253, 310, 350, 388, 680];

// 检查老板是否存在
async function isBossInSystem(bossName) {
  const orders = await DataStore.getOrders();
  return orders.some(o => o.type === 'prepaid' && o.bossName === bossName);
}

// ============ 页面跳转 ============
function navigateTo(page) {
  window.location.href = page;
}

function logout() {
  DataStore.setCurrentUser(null);
  navigateTo('index.html');
}

// ============ 权限检查 ============
function requireLogin() {
  const user = DataStore.getCurrentUser();
  if (!user) {
    navigateTo('index.html');
    return null;
  }
  return user;
}

function requireManager() {
  const user = requireLogin();
  if (user && user.role !== 'manager') {
    navigateTo('receptionist.html');
    return null;
  }
  return user;
}

function requireReceptionist() {
  const user = requireLogin();
  if (user && user.role === 'manager') {
    navigateTo('manager.html');
    return null;
  }
  return user;
}

// ============ 初始化页面 ============
function initPage() {
  // 创建星星背景
  const starsContainer = document.querySelector('.stars-container');
  if (starsContainer) {
    createStars(starsContainer);
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPage);

// ============ 加载指示器 ============
function showLoading(container) {
  if (typeof container === 'string') {
    container = document.getElementById(container);
  }
  if (container) {
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; padding: 40px;">
        <div style="width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
      <style>
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
  }
}

function hideLoading() {
  // 由实际内容替换
}
