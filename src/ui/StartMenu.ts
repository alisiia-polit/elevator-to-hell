import * as BABYLON from '@babylonjs/core';

/**
 * Handles the Start Screen / Main Menu overlay and transition to gameplay.
 */
export class StartMenu {
    private overlayElement: HTMLElement | null;
    private startButton: HTMLElement | null;
    private canvas: HTMLCanvasElement;
    private engine: BABYLON.Engine;
    private onStartCallback?: () => void;
    private isGameStarted: boolean = false;

    constructor(
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        onStart?: () => void
    ) {
        this.engine = engine;
        this.canvas = canvas;
        this.onStartCallback = onStart;

        this.overlayElement = document.getElementById('start-screen') || document.getElementById('start-menu');
        this.startButton = document.getElementById('start-button') || document.getElementById('start-btn') || this.overlayElement;

        this.initEventListeners();
    }

    private initEventListeners(): void {
        const handleStart = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isGameStarted) return;
            this.startGame();
        };

        if (this.startButton) {
            this.startButton.style.cursor = 'pointer';
            this.startButton.style.pointerEvents = 'auto';
            this.startButton.addEventListener('click', handleStart);
            this.startButton.addEventListener('pointerdown', handleStart);
        }

        if (this.overlayElement && this.overlayElement !== this.startButton) {
            this.overlayElement.style.cursor = 'pointer';
            this.overlayElement.style.pointerEvents = 'auto';
            this.overlayElement.addEventListener('click', handleStart);
        }
    }

    public startGame(): void {
        this.isGameStarted = true;

        // 1. Hide Overlay
        if (this.overlayElement) {
            this.overlayElement.style.display = 'none';
        }

        // 2. Request Pointer Lock for FPS Controls
        try {
            this.engine.enterPointerlock();
        } catch (err) {
            console.warn('[StartMenu] Could not enter pointerlock immediately:', err);
            this.canvas.requestPointerLock?.();
        }

        // 3. Focus Canvas
        this.canvas.focus();

        // 4. Trigger Gameplay Start Callback
        if (this.onStartCallback) {
            this.onStartCallback();
        }
    }

    public isStarted(): boolean {
        return this.isGameStarted;
    }
}
