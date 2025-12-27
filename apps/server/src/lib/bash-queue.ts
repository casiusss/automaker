/**
 * Bash Command Queue - Prevents Electron network service crashes
 *
 * Serializes Bash command execution across all concurrent features to prevent
 * subprocess overload that causes macOS to SIGKILL the network service.
 *
 * Analysis of crashes showed that 3+ concurrent features spawning multiple
 * Bash processes simultaneously overwhelms Electron's network service.
 *
 * Uses Claude Agent SDK's PreToolUse hook to intercept and queue Bash commands.
 */

interface QueuedCommand {
  toolUseId: string;
  command: string;
  sessionId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

class BashCommandQueue {
  private queue: QueuedCommand[] = [];
  private processing = false;
  private executingCommand: QueuedCommand | null = null;

  /**
   * Add a Bash command to the queue
   * Returns a promise that resolves when it's this command's turn to execute
   */
  async waitForTurn(toolUseId: string, command: string, sessionId: string): Promise<void> {
    // If queue is empty and not processing, execute immediately
    if (this.queue.length === 0 && !this.processing) {
      console.log('[BashQueue] Executing immediately (queue empty):', {
        command: command.substring(0, 60) + (command.length > 60 ? '...' : ''),
        sessionId: sessionId.substring(0, 8),
      });
      this.processing = true;
      this.executingCommand = {
        toolUseId,
        command,
        sessionId,
        resolve: () => {},
        reject: () => {},
      };
      return Promise.resolve();
    }

    // Otherwise, queue it and wait
    return new Promise<void>((resolve, reject) => {
      this.queue.push({
        toolUseId,
        command,
        sessionId,
        resolve,
        reject,
      });

      console.log('[BashQueue] Enqueued command:', {
        command: command.substring(0, 60) + (command.length > 60 ? '...' : ''),
        sessionId: sessionId.substring(0, 8),
        queuePosition: this.queue.length,
        currentlyExecuting: this.executingCommand
          ? this.executingCommand.command.substring(0, 40)
          : 'none',
      });
    });
  }

  /**
   * Mark the current command as complete and process next in queue
   */
  markComplete(toolUseId: string): void {
    if (this.executingCommand?.toolUseId === toolUseId) {
      console.log('[BashQueue] Command completed:', {
        command: this.executingCommand.command.substring(0, 60),
        remainingInQueue: this.queue.length,
      });

      this.executingCommand = null;
      this.processing = false;

      // Process next command in queue
      this.processNext();
    }
  }

  /**
   * Mark the current command as failed and process next in queue
   */
  markFailed(toolUseId: string, error: string): void {
    if (this.executingCommand?.toolUseId === toolUseId) {
      console.log('[BashQueue] Command failed:', {
        command: this.executingCommand.command.substring(0, 60),
        error: error.substring(0, 100),
        remainingInQueue: this.queue.length,
      });

      this.executingCommand = null;
      this.processing = false;

      // Process next command in queue
      this.processNext();
    }
  }

  /**
   * Process the next command in the queue
   */
  private processNext(): void {
    if (this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift()!;
    this.processing = true;
    this.executingCommand = next;

    console.log('[BashQueue] Processing queued command:', {
      command: next.command.substring(0, 60) + (next.command.length > 60 ? '...' : ''),
      sessionId: next.sessionId.substring(0, 8),
      remainingInQueue: this.queue.length,
    });

    // Resolve the promise to allow the command to execute
    next.resolve();
  }

  /**
   * Get queue status for diagnostics
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      executingCommand: this.executingCommand
        ? {
            command: this.executingCommand.command.substring(0, 50),
            sessionId: this.executingCommand.sessionId.substring(0, 8),
          }
        : null,
    };
  }

  /**
   * Clear the queue (e.g., on shutdown)
   */
  clear() {
    const cleared = this.queue.length;
    this.queue.forEach((item) => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    this.executingCommand = null;
    this.processing = false;
    console.log(`[BashQueue] Cleared ${cleared} queued commands`);
  }
}

// Global singleton instance
export const bashQueue = new BashCommandQueue();
