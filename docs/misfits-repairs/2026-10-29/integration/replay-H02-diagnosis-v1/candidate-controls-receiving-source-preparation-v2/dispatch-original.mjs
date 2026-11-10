export async function probe(action, rejectPhysical = false) {
    const events = [];
    const step = { action };
    const model = {};
    const physicalAction = async () => { events.push('physical'); if (rejectPhysical)
        throw new Error('authored physical failure'); };
    const stepCompletionModel = () => events.push('model');
    const emit = () => events.push('emit');
    try {
        // Model visibility actions describe authored observable checkpoints.
        // They never force production installation or manufacture a receipt.
        if (step.action.type === `cleanup`)
            await physicalAction(step.action);
        stepCompletionModel(model, step.action);
        emit(`completion-baseline-action`, { action: step.action });
        if (step.action.type !== `cleanup`)
            await physicalAction(step.action);
    }
    catch (error) {
        return { events, error: String(error) };
    }
    return { events };
}
