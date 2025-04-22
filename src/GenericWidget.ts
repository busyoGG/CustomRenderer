import { WidgetType } from '@codemirror/view'

export class GenericWidget extends WidgetType {
    constructor(public content: string, public tagName: string, public css: string[]) {
        super();
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement(this.tagName);
        wrapper.textContent = this.content;
        wrapper.classList.add(...this.css);
        return wrapper;
    }

    ignoreEvent(): boolean {
        return false;
    }
}