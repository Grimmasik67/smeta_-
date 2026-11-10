/* Android only: use the system document picker instead of browser blob downloads. */
(() => {
    let pending = null;
    window.NativeExportFinished = success => {
        if (pending) { const finish = pending; pending = null; finish(success === true); }
    };
    App.downloadFile = (content, type, filename) => {
        if (pending) { alert('Сначала заверши сохранение предыдущего файла.'); return Promise.resolve(false); }
        return new Promise(resolve => {
            pending = resolve;
            try { NativeFiles.saveText(String(content), String(type), String(filename)); }
            catch (error) { window.NativeExportFinished(false); alert('Не удалось открыть сохранение файла.'); }
        });
    };
    const saveCurrent = () => {
        const projects = App.readProjects();
        const current = App.collectProject();
        if ((current.name || current.expenses.length) && !projects[App.currentProjectId]?.deletedAt) {
            if (!current.name) current.name = 'Черновик';
            projects[App.currentProjectId] = App.mergeProject(projects[App.currentProjectId], current);
        }
        return App.downloadFile(JSON.stringify({schemaVersion:3, exportedAt:App.stamp(), projects, ...App.teamBackup()}, null, 2), 'application/json', 'Затраты_Бэкап.json');
    };
    App.hardReset = async () => {
        if (!confirm('Очистить базу? Сначала выбери, куда сохранить резервную копию.')) return;
        try {
            if (!await saveCurrent()) return;
            StorageService.set('ledRecovery', StorageService.get('ledProjects') || '{}');
            StorageService.set('ledProjects', '{}');
            for (const key of ['ledTeam','ledTeamRemoved','ledTeamTimes','amountHistory','ledDraft','ledLastProject']) StorageService.del(key);
            App.isDirty = false; App.clearProject(); App.loadTeamList(); App.updateProjectList();
        } catch (error) { App.showError(error); alert('Не удалось очистить базу: ' + error.message); }
    };
    App.restoreRecovery = async () => {
        try {
            const previous = StorageService.get('ledRecovery');
            if (!previous) return;
            const projects = JSON.parse(previous);
            if (!projects || typeof projects !== 'object' || Array.isArray(projects)) throw new Error('Резервная копия повреждена.');
            if (!confirm('Вернуть прежнюю базу? Сначала сохрани текущую базу в файл.')) return;
            if (!await saveCurrent()) return;
            StorageService.set('ledProjects', previous);
            for (const key of ['ledRecovery','ledDraft','ledLastProject']) StorageService.del(key);
            App.isDirty = false; App.clearProject(); App.updateProjectList();
            alert('Прежняя база восстановлена. Выбери объект из списка.');
        } catch (error) { App.showError(error); alert(error.message); }
    };
    window.addEventListener('load', () => {
        document.getElementById('installHelp').hidden = true;
        document.getElementById('appConnectionStatus').textContent = 'Работает без интернета · записи на этом устройстве';
    });
})();
