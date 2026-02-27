"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lockBiz_1 = require("../../utils/lockBiz");
const config_1 = require("../../utils/config");
const api_1 = require("../../utils/api");
const configView_1 = require("../../utils/configView");
function createLoginForm() {
    return { phone: '', idcardNo: '' };
}
function createForm(partial) {
    return (0, configView_1.normalizeConfigForForm)((0, config_1.createEmptyDoorConfig)(partial));
}
function resolvePlatform() {
    const wxAny = wx;
    const readers = [
        () => (typeof wxAny.getAppBaseInfo === 'function' ? wxAny.getAppBaseInfo() : null),
        () => (typeof wxAny.getDeviceInfo === 'function' ? wxAny.getDeviceInfo() : null),
        () => (typeof wxAny.getWindowInfo === 'function' ? wxAny.getWindowInfo() : null)
    ];
    for (const reader of readers) {
        try {
            const info = reader();
            const platform = info && typeof info.platform === 'string' ? info.platform.trim() : '';
            if (platform) {
                return platform.toLowerCase();
            }
        }
        catch (err) {
            console.debug('[config] 读取平台信息失败', err);
        }
    }
    return '';
}
const DRAFT_STORAGE_KEY = 'configDraft';
const SHARE_QUERY_KEY = 'sharedDoor';
const SHARE_EXPIRE_QUERY_KEY = 'sharedDoorExp';
const SHARE_PAYLOAD_VERSION = 1;
const SHARE_LINK_TTL_MS = 24 * 60 * 60 * 1000;
function buildCopyPayload(config) {
    const name = (config.doorName || '').trim() || '未命名';
    const mac = (config.mac || '').trim() || '缺失';
    const key = (config.key || '').trim() || '缺失';
    const bluetooth = (config.bluetoothName || '').trim() || '缺失';
    return `门禁名称：${name}\nMAC：${mac}\nKey：${key}\n蓝牙名称：${bluetooth}`;
}
function buildCopyPayloadList(configs) {
    const list = Array.isArray(configs) ? configs : [];
    if (!list.length) {
        return '';
    }
    if (list.length === 1) {
        return buildCopyPayload(list[0]);
    }
    return list
        .map((config, index) => `【门禁 ${index + 1}】\n${buildCopyPayload(config)}`)
        .join('\n\n');
}
function encodeSharedDoor(config, expireAt) {
    const normalized = (0, configView_1.normalizeConfigForForm)(config);
    if (!(0, lockBiz_1.isValidMac)(normalized.mac) || !(0, lockBiz_1.isValidKey)(normalized.key)) {
        return '';
    }
    const payload = {
        v: SHARE_PAYLOAD_VERSION,
        n: (normalized.doorName || '').trim(),
        m: normalized.mac,
        k: normalized.key,
        b: (normalized.bluetoothName || '').trim(),
        exp: expireAt
    };
    return encodeURIComponent(JSON.stringify(payload));
}
function parseShareExpireAt(options) {
    if (!options || typeof options[SHARE_EXPIRE_QUERY_KEY] !== 'string') {
        return null;
    }
    const expireAt = Number((options[SHARE_EXPIRE_QUERY_KEY] || '').trim());
    if (!Number.isFinite(expireAt) || expireAt <= 0) {
        return null;
    }
    return expireAt;
}
function decodeSharedDoor(raw, logEnabled, optionExpireAt) {
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        if (!parsed || parsed.v !== SHARE_PAYLOAD_VERSION) {
            return null;
        }
        const payloadExpireAt = typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) && parsed.exp > 0
            ? parsed.exp
            : null;
        const expireAt = typeof optionExpireAt === 'number' && Number.isFinite(optionExpireAt) && optionExpireAt > 0
            ? optionExpireAt
            : payloadExpireAt;
        if (!expireAt || Date.now() >= expireAt) {
            return 'expired';
        }
        const normalized = (0, configView_1.normalizeConfigForForm)({
            id: undefined,
            doorName: typeof parsed.n === 'string' ? parsed.n : '',
            mac: typeof parsed.m === 'string' ? parsed.m : '',
            key: typeof parsed.k === 'string' ? parsed.k : '',
            bluetoothName: typeof parsed.b === 'string' ? parsed.b : '',
            logEnabled
        });
        if (!(0, lockBiz_1.isValidMac)(normalized.mac) || !(0, lockBiz_1.isValidKey)(normalized.key)) {
            return null;
        }
        return normalized;
    }
    catch (err) {
        return null;
    }
}
function parseBackupDoorsFromText(text, logEnabled) {
    const raw = (text || '').trim();
    if (!raw) {
        return [];
    }
    const lines = raw.split(/\r?\n/);
    const blocks = [];
    let current = { doorName: '', mac: '', key: '', bluetoothName: '' };
    const pushCurrentIfNeeded = () => {
        if (current.doorName || current.mac || current.key || current.bluetoothName) {
            blocks.push(current);
            current = { doorName: '', mac: '', key: '', bluetoothName: '' };
        }
    };
    for (const rawLine of lines) {
        const line = (rawLine || '').trim();
        if (!line) {
            continue;
        }
        if (/^【门禁\s*\d+】$/.test(line)) {
            pushCurrentIfNeeded();
            continue;
        }
        const nameMatch = line.match(/^门禁名称[：:]\s*(.+)$/i);
        if (nameMatch) {
            current.doorName = nameMatch[1].trim();
            continue;
        }
        const macMatch = line.match(/^MAC[：:]\s*(.+)$/i);
        if (macMatch) {
            current.mac = macMatch[1].trim();
            continue;
        }
        const keyMatch = line.match(/^Key[：:]\s*(.+)$/i);
        if (keyMatch) {
            current.key = keyMatch[1].trim();
            continue;
        }
        const bluetoothMatch = line.match(/^蓝牙名称[：:]\s*(.+)$/i);
        if (bluetoothMatch) {
            current.bluetoothName = bluetoothMatch[1].trim();
            continue;
        }
    }
    pushCurrentIfNeeded();
    return blocks
        .map((item) => (0, configView_1.normalizeConfigForForm)({
        id: undefined,
        doorName: item.doorName || '导入门禁',
        mac: item.mac,
        key: item.key,
        bluetoothName: item.bluetoothName,
        logEnabled
    }))
        .filter((item) => (0, lockBiz_1.isValidMac)(item.mac) && (0, lockBiz_1.isValidKey)(item.key));
}
function readDraftState() {
    try {
        const raw = wx.getStorageSync(DRAFT_STORAGE_KEY);
        if (raw && typeof raw === 'object') {
            return raw;
        }
    }
    catch (err) {
        console.warn('[config] 读取草稿失败', err);
    }
    return {};
}
function writeDraftState(state) {
    try {
        if (!state || !Object.keys(state).length) {
            wx.removeStorageSync(DRAFT_STORAGE_KEY);
            return;
        }
        wx.setStorageSync(DRAFT_STORAGE_KEY, state);
    }
    catch (err) {
        console.warn('[config] 写入草稿失败', err);
    }
}
Page({
    data: {
        form: (0, configView_1.normalizeConfigForForm)(config_1.DEFAULT_CONFIG),
        saving: false,
        canSave: false,
        loginForm: createLoginForm(),
        fetchingRemote: false,
        configs: [],
        configNames: [],
        configOptions: [],
        selectedConfigIndex: 0,
        selectorOpen: false,
        isIOS: false,
        logEnabled: false,
        quickUnlockEnabled: false,
        autoRetryUnlockEnabled: false,
        autoRetryUnlockCount: 8,
        sharePrompt: {
            visible: false,
            countdown: 0
        },
        backupCopyPrompt: {
            visible: false,
            items: [],
            selectedCount: 0
        },
        backupImportInput: {
            visible: false,
            text: ''
        },
        importPrompt: {
            visible: false,
            lines: []
        },
        copyPrompt: {
            visible: false,
            lines: [],
            copyText: ''
        }
    },
    onLoad(options) {
        wx.showShareMenu({
            menus: ['shareAppMessage', 'shareTimeline']
        });
        this.tryImportSharedDoor(options);
    },
    onShow() {
        this.detectPlatform();
        this.refreshConfigState();
    },
    onHide() {
        this.clearShareReminderTimer();
    },
    onUnload() {
        this.clearShareReminderTimer();
    },
    onShareAppMessage() {
        const current = this.getCurrentForm();
        const expireAt = Date.now() + SHARE_LINK_TTL_MS;
        const encoded = encodeSharedDoor(current, expireAt);
        if (!encoded) {
            return {
                title: 'BaiyunKeys',
                path: '/pages/config/index'
            };
        }
        const shareTitle = current.doorName ? `BaiyunKeys - ${current.doorName}` : 'BaiyunKeys - Door';
        return {
            title: shareTitle,
            path: `/pages/config/index?${SHARE_QUERY_KEY}=${encoded}&${SHARE_EXPIRE_QUERY_KEY}=${expireAt}`
        };
    },
    onShareTimeline() {
        const current = this.getCurrentForm();
        const expireAt = Date.now() + SHARE_LINK_TTL_MS;
        const encoded = encodeSharedDoor(current, expireAt);
        if (!encoded) {
            return {
                title: 'BaiyunKeys'
            };
        }
        const shareTitle = current.doorName ? `BaiyunKeys - ${current.doorName}` : 'BaiyunKeys - Door';
        return {
            title: shareTitle,
            query: `${SHARE_QUERY_KEY}=${encoded}&${SHARE_EXPIRE_QUERY_KEY}=${expireAt}`
        };
    },
    showShareReminder() {
        this.clearShareReminderTimer();
        this.setData({
            sharePrompt: {
                visible: true,
                countdown: 10
            }
        });
        const timer = setInterval(() => {
            const current = this.data.sharePrompt && typeof this.data.sharePrompt.countdown === 'number'
                ? this.data.sharePrompt.countdown
                : 0;
            if (current <= 1) {
                this.clearShareReminderTimer();
                this.setData({ 'sharePrompt.countdown': 0 });
                return;
            }
            this.setData({ 'sharePrompt.countdown': current - 1 });
        }, 1000);
        this._shareReminderTimer = timer;
    },
    clearShareReminderTimer() {
        const self = this;
        const timer = self._shareReminderTimer;
        if (timer) {
            clearInterval(timer);
            self._shareReminderTimer = null;
        }
    },
    onShareButtonTap() {
        const form = this.getCurrentForm();
        if (!form.id) {
            wx.showToast({ title: '请先保存门禁', icon: 'none' });
            return;
        }
        this.showShareReminder();
    },
    onShareReminderCancel() {
        this.clearShareReminderTimer();
        this.setData({
            sharePrompt: {
                visible: false,
                countdown: 0
            }
        });
    },
    onShareReminderConfirm() {
        if (this.data.sharePrompt && this.data.sharePrompt.countdown > 0) {
            return;
        }
        setTimeout(() => {
            this.onShareReminderCancel();
        }, 80);
    },
    showImportPrompt(lines) {
        this.setData({
            importPrompt: {
                visible: true,
                lines: lines.filter((line) => !!line && !!line.trim())
            }
        });
    },
    onImportPromptConfirm() {
        this.setData({
            importPrompt: {
                visible: false,
                lines: []
            }
        });
    },
    tryImportSharedDoor(options) {
        if (!options || typeof options[SHARE_QUERY_KEY] !== 'string') {
            return;
        }
        const raw = (options[SHARE_QUERY_KEY] || '').trim();
        if (!raw) {
            return;
        }
        const optionExpireAt = parseShareExpireAt(options);
        const logEnabled = (0, config_1.readLogPreference)();
        const shared = decodeSharedDoor(raw, logEnabled, optionExpireAt);
        if (shared === 'expired') {
            wx.showToast({ title: '分享链接已过期，请重新分享', icon: 'none' });
            return;
        }
        if (!shared) {
            wx.showToast({ title: '分享门禁数据无效', icon: 'none' });
            return;
        }
        const existingList = (0, config_1.readDoorConfigList)();
        const duplicate = existingList.find((item) => item.mac === shared.mac &&
            item.key === shared.key &&
            item.bluetoothName === shared.bluetoothName);
        if (duplicate) {
            const active = (0, config_1.setActiveDoorConfig)(duplicate.id);
            const refreshed = (0, config_1.readDoorConfigList)();
            this.applyConfigState(active, refreshed);
            wx.showToast({ title: '门禁已存在，已自动选中', icon: 'none' });
            return;
        }
        const stored = (0, config_1.saveDoorConfig)(shared);
        const refreshed = (0, config_1.readDoorConfigList)();
        this.applyConfigState(stored, refreshed);
        const name = stored.doorName || '未命名';
        const bluetoothName = stored.bluetoothName || '无';
        this.showImportPrompt([
            `门禁名称：${name}`,
            `MAC：${stored.mac}`,
            `Key：${stored.key}`,
            `蓝牙名称：${bluetoothName}`
        ]);
    },
    detectPlatform() {
        const platform = resolvePlatform();
        if (platform) {
            this.setData({ isIOS: platform === 'ios' });
            return;
        }
        this.setData({ isIOS: false });
    },
    refreshConfigState() {
        const list = (0, config_1.readDoorConfigList)();
        const active = (0, config_1.readDoorConfig)();
        this.applyConfigState(active, list);
        this.restoreDraft();
    },
    applyConfigState(active, list) {
        const form = (0, configView_1.normalizeConfigForForm)(active);
        const logEnabled = (0, config_1.readLogPreference)();
        const quickUnlockEnabled = (0, config_1.readQuickUnlockPreference)();
        const autoRetryUnlockEnabled = (0, config_1.readAutoRetryUnlockPreference)();
        const autoRetryUnlockCount = (0, config_1.readAutoRetryUnlockCountPreference)();
        const nextForm = { ...form, logEnabled };
        const { configs, configNames, configOptions, selectedConfigIndex } = (0, configView_1.buildConfigCollections)(list, form.id || null);
        this.setData({
            form: nextForm,
            configs,
            configNames,
            configOptions,
            selectedConfigIndex,
            selectorOpen: false,
            logEnabled,
            quickUnlockEnabled,
            autoRetryUnlockEnabled,
            autoRetryUnlockCount
        });
        this.updateCanSave(nextForm);
    },
    getCurrentForm() {
        return this.data.form;
    },
    updateCanSave(targetForm) {
        const form = targetForm || this.getCurrentForm();
        const requireBluetooth = this.data.isIOS;
        const ready = !!form.doorName &&
            (0, lockBiz_1.isValidMac)(form.mac) &&
            (0, lockBiz_1.isValidKey)(form.key) &&
            (!requireBluetooth || !!form.bluetoothName);
        this.setData({ canSave: ready });
    },
    updateFormField(field, value) {
        this.setData({ [`form.${field}`]: value });
        this.updateCanSave();
    },
    getActiveDraftKey() {
        const form = this.getCurrentForm();
        return form.id || '__temp__';
    },
    cacheDraft(partial) {
        const draftState = readDraftState();
        const key = this.getActiveDraftKey();
        const existing = draftState[key] || {};
        draftState[key] = { ...existing, ...partial, timestamp: Date.now() };
        writeDraftState(draftState);
    },
    restoreDraft() {
        const draftState = readDraftState();
        const key = this.getActiveDraftKey();
        const draft = draftState[key];
        const current = this.getCurrentForm();
        const merged = {
            ...current,
            doorName: draft && typeof draft.doorName === 'string' ? draft.doorName : current.doorName,
            mac: draft && typeof draft.mac === 'string' ? draft.mac : current.mac,
            key: draft && typeof draft.key === 'string' ? draft.key : current.key,
            bluetoothName: draft && typeof draft.bluetoothName === 'string' ? draft.bluetoothName : current.bluetoothName,
            logEnabled: current.logEnabled
        };
        this.setData({
            form: merged
        });
        this.updateCanSave(merged);
    },
    clearDraft() {
        const draftState = readDraftState();
        const key = this.getActiveDraftKey();
        if (draftState[key]) {
            delete draftState[key];
        }
        writeDraftState(draftState);
    },
    showCopyReminder(copyText) {
        const lines = copyText.split('\n').filter((line) => line.trim().length > 0);
        const contentLines = [
            '已自动获取门禁参数，请立即备份（建议收藏到微信），以便随时恢复使用。'
        ].concat(lines).concat(['提示：iOS 需保留蓝牙名称，安卓用户也建议一并保存。']);
        return new Promise((resolve) => {
            const self = this;
            self._copyResolve = resolve;
            this.setData({
                copyPrompt: {
                    visible: true,
                    lines: contentLines,
                    copyText
                }
            });
        });
    },
    closeCopyPrompt() {
        const self = this;
        const resolver = self._copyResolve;
        self._copyResolve = null;
        this.setData({
            copyPrompt: {
                visible: false,
                lines: [],
                copyText: ''
            }
        });
        if (typeof resolver === 'function') {
            resolver();
        }
    },
    onDoorNameInput(event) {
        const value = (event.detail.value || '').trim();
        this.updateFormField('doorName', value);
        this.cacheDraft({ doorName: value });
    },
    onMacInput(event) {
        const value = (0, lockBiz_1.sanitizeMacInput)(event.detail.value || '');
        this.updateFormField('mac', value);
        this.cacheDraft({ mac: value });
    },
    onKeyInput(event) {
        const value = (0, lockBiz_1.sanitizeKey)(event.detail.value || '');
        this.updateFormField('key', value);
        this.cacheDraft({ key: value });
    },
    onBluetoothNameInput(event) {
        if (!this.data.isIOS) {
            return;
        }
        const value = (event.detail.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        this.updateFormField('bluetoothName', value);
        this.cacheDraft({ bluetoothName: value });
    },
    onPhoneInput(event) {
        const value = (event.detail.value || '').replace(/\D/g, '').slice(0, 11);
        this.setData({ 'loginForm.phone': value });
    },
    onIdcardInput(event) {
        const value = (event.detail.value || '').toUpperCase().replace(/[^0-9X]/g, '').slice(0, 18);
        this.setData({ 'loginForm.idcardNo': value });
    },
    onCopyConfirm() {
        const text = this.data.copyPrompt.copyText || '';
        if (!text) {
            this.closeCopyPrompt();
            return;
        }
        wx.setClipboardData({
            data: text,
            success: () => {
                wx.showToast({ title: '配置已复制', icon: 'success', duration: 1200 });
                this.closeCopyPrompt();
            },
            fail: () => {
                wx.showToast({ title: '复制失败，请手动复制', icon: 'none', duration: 1800 });
                this.closeCopyPrompt();
            }
        });
    },
    onCopyBackup() {
        const list = (0, config_1.readDoorConfigList)();
        if (!list.length) {
            wx.showToast({ title: '暂无可复制门禁，请先保存配置', icon: 'none' });
            return;
        }
        const activeId = this.getCurrentForm().id || list[0].id;
        const items = list.map((item, index) => ({
            id: item.id,
            name: (item.doorName || '').trim() || `门禁 ${index + 1}`,
            checked: item.id === activeId
        }));
        const selectedCount = items.filter((item) => item.checked).length;
        this.setData({
            backupCopyPrompt: {
                visible: true,
                items,
                selectedCount
            }
        });
    },
    onImportBackup() {
        this.setData({
            backupImportInput: {
                visible: true,
                text: ''
            }
        });
    },
    onBackupCopyCancel() {
        this.setData({
            backupCopyPrompt: {
                visible: false,
                items: [],
                selectedCount: 0
            }
        });
    },
    onBackupCopyToggle(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) {
            return;
        }
        const items = this.data.backupCopyPrompt.items.map((item) => item.id === id ? { ...item, checked: !item.checked } : item);
        const selectedCount = items.filter((item) => item.checked).length;
        this.setData({
            backupCopyPrompt: {
                visible: true,
                items,
                selectedCount
            }
        });
    },
    onBackupCopyToggleAll() {
        const state = this.data.backupCopyPrompt;
        const targetChecked = !(state.selectedCount === state.items.length && state.items.length > 0);
        const items = state.items.map((item) => ({ ...item, checked: targetChecked }));
        const selectedCount = targetChecked ? items.length : 0;
        this.setData({
            backupCopyPrompt: {
                visible: true,
                items,
                selectedCount
            }
        });
    },
    onBackupCopyConfirm() {
        const state = this.data.backupCopyPrompt;
        const selectedIds = state.items.filter((item) => item.checked).map((item) => item.id);
        if (!selectedIds.length) {
            wx.showToast({ title: '请先勾选门禁', icon: 'none' });
            return;
        }
        const selectedConfigs = (0, config_1.readDoorConfigList)().filter((item) => selectedIds.includes(item.id));
        if (!selectedConfigs.length) {
            wx.showToast({ title: '未找到可复制的门禁', icon: 'none' });
            return;
        }
        const copyText = buildCopyPayloadList(selectedConfigs);
        wx.setClipboardData({
            data: copyText,
            success: () => {
                this.onBackupCopyCancel();
                wx.showToast({ title: '门禁参数已复制', icon: 'success', duration: 1200 });
            },
            fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none', duration: 1600 })
        });
    },
    onBackupImportInput(event) {
        const value = event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
        this.setData({ 'backupImportInput.text': value });
    },
    onBackupImportCancel() {
        this.setData({
            backupImportInput: {
                visible: false,
                text: ''
            }
        });
    },
    onBackupImportConfirm() {
        const text = this.data.backupImportInput.text || '';
        const importedList = parseBackupDoorsFromText(text, this.data.logEnabled);
        if (!importedList.length) {
            wx.showToast({ title: '未识别到有效门禁参数', icon: 'none' });
            return;
        }
        const comparePool = (0, config_1.readDoorConfigList)().slice();
        const imported = [];
        let duplicateCount = 0;
        let duplicateNameCount = 0;
        let iosMissingBtCount = 0;
        for (const config of importedList) {
            if (this.data.isIOS && !config.bluetoothName) {
                iosMissingBtCount += 1;
                continue;
            }
            const duplicated = comparePool.find((item) => item.mac === config.mac &&
                item.key === config.key &&
                item.bluetoothName === config.bluetoothName);
            if (duplicated) {
                duplicateCount += 1;
                continue;
            }
            const duplicatedName = comparePool.some((item) => (item.doorName || '').trim() === config.doorName);
            if (duplicatedName) {
                duplicateNameCount += 1;
                continue;
            }
            const stored = (0, config_1.saveDoorConfig)(config);
            comparePool.push(stored);
            imported.push(stored);
        }
        if (!imported.length) {
            if (iosMissingBtCount > 0) {
                wx.showToast({ title: 'iOS 导入需包含蓝牙名称', icon: 'none' });
                return;
            }
            if (duplicateNameCount > 0) {
                wx.showToast({ title: '门禁名称重复，导入失败', icon: 'none' });
                return;
            }
            wx.showToast({ title: '门禁已存在，无需重复导入', icon: 'none' });
            return;
        }
        const active = (0, config_1.setActiveDoorConfig)(imported[0].id);
        const refreshed = (0, config_1.readDoorConfigList)();
        this.applyConfigState(active, refreshed);
        this.onBackupImportCancel();
        const lines = [`成功导入 ${imported.length} 套门禁`];
        if (duplicateCount > 0) {
            lines.push(`已跳过重复参数：${duplicateCount} 套`);
        }
        imported.forEach((item, index) => {
            lines.push(`【门禁 ${index + 1}】`);
            lines.push(`门禁名称：${item.doorName || '未命名'}`);
            lines.push(`MAC：${item.mac}`);
            lines.push(`Key：${item.key}`);
            lines.push(`蓝牙名称：${item.bluetoothName || '无'}`);
        });
        if (duplicateNameCount > 0) {
            lines.push(`已跳过重名门禁：${duplicateNameCount} 套`);
        }
        if (iosMissingBtCount > 0) {
            lines.push(`已跳过缺少蓝牙名（iOS 必填）：${iosMissingBtCount} 套`);
        }
        this.showImportPrompt(lines);
    },
    toggleConfigSelector() {
        if (!this.data.configs.length) {
            wx.showToast({ title: '请先新增并保存门禁', icon: 'none' });
            return;
        }
        this.setData({ selectorOpen: !this.data.selectorOpen });
    },
    onSelectConfig(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) {
            this.setData({ selectorOpen: false });
            return;
        }
        this.clearDraft();
        const active = (0, config_1.setActiveDoorConfig)(id);
        const list = (0, config_1.readDoorConfigList)();
        this.applyConfigState(active, list);
    },
    onAddConfig() {
        const nextForm = createForm({ logEnabled: this.data.logEnabled });
        this.clearDraft();
        this.setData({
            form: nextForm,
            selectorOpen: false
        });
        this.updateCanSave(nextForm);
        wx.showToast({ title: '已创建新门禁，请填写参数', icon: 'none' });
    },
    onDeleteConfig() {
        const current = this.getCurrentForm();
        if (!current.id) {
            wx.showToast({ title: '尚未保存的门禁无需删除', icon: 'none' });
            return;
        }
        wx.showModal({
            title: '确认删除',
            content: '删除后将无法使用该门禁配置，确定继续？',
            success: (res) => {
                if (!res.confirm) {
                    return;
                }
                (0, config_1.deleteDoorConfig)(current.id);
                this.refreshConfigState();
                this.clearDraft();
                wx.showToast({ title: '已删除', icon: 'none' });
            }
        });
    },
    onLogToggle(event) {
        const next = !!event.detail.value;
        (0, config_1.saveLogPreference)(next);
        this.setData({
            logEnabled: next,
            'form.logEnabled': next
        });
        wx.showToast({ title: next ? '已开启调试日志' : '已关闭调试日志', icon: 'none', duration: 1200 });
    },
    onQuickUnlockToggle(event) {
        const next = !!event.detail.value;
        (0, config_1.saveQuickUnlockPreference)(next);
        this.setData({ quickUnlockEnabled: next });
        wx.showToast({ title: next ? '已开启快速开锁' : '已关闭快速开锁', icon: 'none', duration: 1200 });
    },
    onAutoRetryUnlockCountInput(event) {
        const raw = (event.detail.value || '').replace(/\D/g, '');
        if (!raw) {
            this.setData({ autoRetryUnlockCount: '' });
            return;
        }
        const normalized = (0, config_1.normalizeAutoRetryUnlockCount)(raw);
        this.setData({ autoRetryUnlockCount: normalized });
    },
    onAutoRetryUnlockCountBlur(event) {
        const raw = (event.detail.value || '').replace(/\D/g, '');
        const normalized = (0, config_1.normalizeAutoRetryUnlockCount)(raw);
        (0, config_1.saveAutoRetryUnlockCountPreference)(normalized);
        this.setData({ autoRetryUnlockCount: normalized });
    },
    onAutoRetryUnlockToggle(event) {
        const next = !!event.detail.value;
        (0, config_1.saveAutoRetryUnlockPreference)(next);
        this.setData({ autoRetryUnlockEnabled: next });
        wx.showToast({ title: next ? '已开启自动重发' : '已关闭自动重发', icon: 'none', duration: 1200 });
    },
    normalizeFetchedConfig(item) {
        const current = this.getCurrentForm();
        const base = {
            id: undefined,
            doorName: ((item && item.address) || item.name || current.doorName || '').trim(),
            mac: item && item.macNum ? item.macNum : '',
            key: item && item.productKey ? item.productKey : '',
            bluetoothName: item && item.bluetoothName ? item.bluetoothName : '',
            logEnabled: this.data.logEnabled
        };
        const normalized = (0, configView_1.normalizeConfigForForm)(base);
        const requiresBluetoothName = !!this.data.isIOS;
        if (!(0, lockBiz_1.isValidMac)(normalized.mac) || !(0, lockBiz_1.isValidKey)(normalized.key) || (requiresBluetoothName && !normalized.bluetoothName)) {
            throw new Error('返回的门锁参数不完整或格式无效');
        }
        return normalized;
    },
    async onFetchRemoteConfig() {
        if (this.data.fetchingRemote) {
            return;
        }
        const phone = (this.data.loginForm.phone || '').trim();
        const idcardNo = (this.data.loginForm.idcardNo || '').trim().toUpperCase();
        if (!idcardNo) {
            wx.showToast({ title: '请填写身份证号', icon: 'none' });
            return;
        }
        this.setData({ fetchingRemote: true });
        let auth = null;
        try {
            auth = await (0, api_1.login)(phone, idcardNo);
            const list = await (0, api_1.fetchEntranceGuardList)(auth);
            if (!list.length) {
                throw new Error('未获取到门禁信息');
            }
            const isSameConfig = (left, right) => left.doorName === right.doorName &&
                left.mac === right.mac &&
                left.key === right.key &&
                left.bluetoothName === right.bluetoothName;
            const comparePool = (0, config_1.readDoorConfigList)().slice();
            const imported = [];
            let firstDuplicate = null;
            let duplicateCount = 0;
            let skippedCount = 0;
            for (const item of list) {
                let config;
                try {
                    config = this.normalizeFetchedConfig(item);
                }
                catch (normalizeErr) {
                    skippedCount += 1;
                    continue;
                }
                const duplicate = comparePool.find((entry) => isSameConfig(entry, config));
                if (duplicate) {
                    duplicateCount += 1;
                    if (!firstDuplicate) {
                        firstDuplicate = duplicate;
                    }
                    continue;
                }
                const stored = (0, config_1.saveDoorConfig)(config);
                comparePool.push(stored);
                imported.push(stored);
            }
            if (!imported.length) {
                if (firstDuplicate) {
                    const active = (0, config_1.setActiveDoorConfig)(firstDuplicate.id);
                    const refreshed = (0, config_1.readDoorConfigList)();
                    this.applyConfigState(active, refreshed);
                    wx.showToast({ title: '已存在相同门禁，已为你选中', icon: 'none' });
                    this.setData({ loginForm: createLoginForm() });
                    this.clearDraft();
                    await this.showCopyReminder(buildCopyPayload(active));
                    return;
                }
                throw new Error('未获取到可导入的门禁信息');
            }
            const firstImported = imported[0];
            const active = (0, config_1.setActiveDoorConfig)(firstImported.id);
            const refreshed = (0, config_1.readDoorConfigList)();
            this.applyConfigState(active, refreshed);
            console.info('[config] remote guard import summary', {
                total: list.length,
                imported: imported.length,
                duplicateCount,
                skippedCount
            });
            this.setData({ loginForm: createLoginForm() });
            this.clearDraft();
            const copyPayload = buildCopyPayloadList(imported);
            await this.showCopyReminder(copyPayload || buildCopyPayload(active));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : '获取配置失败';
            console.error('[config] 获取远程配置失败', err);
            const toastDuration = message.length > 20 ? 5000 : 3000;
            wx.showToast({ title: message, icon: 'none', duration: toastDuration });
        }
        finally {
            this.setData({ fetchingRemote: false });
            if (auth) {
                await (0, api_1.logout)(auth);
            }
        }
    },
    async onSave() {
        if (this.data.saving || !this.data.canSave) {
            return;
        }
        this.setData({ saving: true });
        try {
            const payload = (0, configView_1.normalizeConfigForForm)({
                ...this.getCurrentForm(),
                logEnabled: this.data.logEnabled
            });
            if (!payload.bluetoothName && payload.id) {
                const existing = (0, config_1.readDoorConfigList)().find((item) => item.id === payload.id);
                if (existing && existing.bluetoothName) {
                    payload.bluetoothName = existing.bluetoothName;
                }
            }
            const existsSameName = (0, config_1.readDoorConfigList)().some((item) => item.id !== payload.id && ((item.doorName || '').trim() === payload.doorName));
            if (existsSameName) {
                wx.showToast({ title: '门禁名称重复，请重新命名后再保存', icon: 'none' });
                return;
            }
            const stored = (0, config_1.saveDoorConfig)(payload);
            const refreshed = (0, config_1.readDoorConfigList)();
            this.applyConfigState(stored, refreshed);
            wx.showToast({ title: '保存成功', icon: 'success', duration: 1200 });
            this.clearDraft();
        }
        catch (err) {
            console.error('[config] 保存失败', err);
            wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    }
});
