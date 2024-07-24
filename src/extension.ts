import * as vscode from 'vscode';
import { window } from 'vscode';
import * as cloud from './clound';

export function activate(context: vscode.ExtensionContext) {
    const cloudinput = new cloud.Cloudinput();
    const input_state = new inputState(cloudinput);

    let statusBarItem: vscode.StatusBarItem;

    function createStatusBarItem() {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'google-input.toggle';
        context.subscriptions.push(statusBarItem);
        updateStatusBarItem();
    }

    function updateStatusBarItem() {
        const enabled = context.globalState.get('google-input.enabled', false);
        if (enabled) {
            statusBarItem.text = '$(check) Google Input: On';
        } else {
            statusBarItem.text = '$(x) Google Input: Off';
        }
        statusBarItem.show();
    }

    context.subscriptions.push(vscode.commands.registerCommand('google-input.toggle', () => {
        const enabled = context.globalState.get('google-input.enabled', false);
        context.globalState.update('google-input.enabled', !enabled);
        vscode.commands.executeCommand("setContext", "google-input.enabled", !enabled);
        vscode.commands.executeCommand("setContext", "google-input.selecting", false);
        if (!enabled) {
            input_state.hide();
        }
        updateStatusBarItem();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('google-input.pagenext', () => {
        input_state.pagenext();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('google-input.pageprev', () => {
        input_state.pageprev();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('google-input.accept.selected', () => {
        input_state.acceptSelected();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('google-input.input.unsolved', () => {
        input_state.inputUnsolved();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('google-input.accept.first', () => {
        input_state.acceptFirst();
    }));

    for (let i = 0; i < 26; i += 1) {
        const ch = String.fromCharCode('a'.charCodeAt(0) + i);
        context.subscriptions.push(vscode.commands.registerCommand('google-input.typing.' + ch, () => {
            input_state.typing(ch);
        }));
    }

    for (let i = 1; i <= 8; i += 1) {
        const ch = String.fromCharCode('0'.charCodeAt(0) + i);
        context.subscriptions.push(vscode.commands.registerCommand('google-input.typing.' + ch, () => {
            input_state.typingNum(i);
        }));
    }

    createStatusBarItem(); // Create the status bar item when the extension is activated
}

type MyQuickPickItem = vscode.QuickPickItem & { result: cloud.SearchResult };

class inputState {
    readonly quickPick = window.createQuickPick<MyQuickPickItem>();
    index_updated = 0;
    index = 0;
    page = 0;
    constructor(readonly cloudinput: cloud.Cloudinput) {
        this.quickPick.matchOnDetail = true;
        this.quickPick.onDidChangeValue(() => this.onDidChangeValue());
        this.quickPick.onDidAccept(() => this.onDidAccept());
        this.quickPick.onDidHide(() => this.onDidHide());
    }
    show() {
        vscode.commands.executeCommand("setContext", "google-input.selecting", true);
        this.quickPick.show();
    }

    pageprev() {
        if (this.page > 0) {
            this.page -= 1;
        }
        this.searchAndShow();
    }

    pagenext() {
        this.page += 1;
        this.searchAndShow();
    }
    typing(ch: string) {
        this.show();
        this.quickPick.value += ch;
        this.onDidChangeValue();
    }
    typingNum(n: number) {
        if (this.quickPick.items[n - 1]) {
            this.accept(this.quickPick.items[n - 1]);
        }
    }

    onDidChangeValue() {
        if (!this.quickPick.value) {
            this.quickPick.hide();
            return;
        }
        this.page = 0;
        this.searchAndShow();
    }
    async searchAndShow() {
        this.quickPick.busy = true;
        this.index += 1;
        const my_index = this.index;

        const item_count = (this.page + 1) * 8;
        const value = this.quickPick.value;
        const result = await this.cloudinput.search(this.quickPick.value, item_count);
        if (!result) {
            return;
        }
        if (my_index < this.index_updated) {
            window.showInformationMessage(`ignore the result with index ${my_index}`);
            return;
        }
        this.index_updated = my_index;
        this.quickPick.items = result
            .slice(this.page * 8, (this.page + 1) * 8)
            .filter(v => !v.nword.toLowerCase().includes(value))
            .map((v, i) =>
                ({ label: `${i + 1}: ${v.nword}`, alwaysShow: true, result: v })
            );
        if (my_index === this.index) {
            this.quickPick.busy = false;
        }
    }
    acceptFirst() {
        if (this.quickPick.items[0]) {
            this.accept(this.quickPick.items[0]);
        }
    }
    acceptSelected() {
        if (this.quickPick.selectedItems[0]) {
            this.accept(this.quickPick.selectedItems[0]);
        }
    }

    inputUnsolved() {
        editorInsert(this.quickPick.value);
        this.quickPick.value = "";
        this.quickPick.hide();
    }

    accept(item: MyQuickPickItem) {
        editorInsert(item.result.nword);
        this.quickPick.value = this.quickPick.value.substr(item.result.matchedLength);
        this.onDidChangeValue();
    }

    onDidAccept() {
        this.inputUnsolved();
    }
    onDidHide() {
        this.quickPick.value = "";
        this.index_updated = this.index;
        vscode.commands.executeCommand("setContext", "google-input.selecting", false);
    }
    hide() {
        this.quickPick.hide();
    }
}

const editorInsert = (text: string) => {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const position = editor.selections[0].anchor;
    editor.edit(editBuilder => {
        editBuilder.insert(position, text);
    });
    vscode.commands.executeCommand('editor.action.triggerSuggest');
};

// This method is called when your extension is deactivated
export function deactivate() {}
