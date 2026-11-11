import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

export const projectBox = (label = 'Project') => screen.findByRole('combobox', { name: label }) as Promise<HTMLInputElement>;

/** Opens the project choice and clicks the option with exactly this text. */
export async function chooseProject(user: UserEvent, optionName: string, label = 'Project') {
  await user.click(await projectBox(label));
  await user.click(await screen.findByRole('option', { name: optionName }));
}
