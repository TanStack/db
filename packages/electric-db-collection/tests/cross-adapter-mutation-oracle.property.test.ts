/** Installed ShapeStream receives the shared explicit-confirmation judgment. */
import { registerElectricMutation } from './cross-adapter-mutation-registration-oracle'
import { observeElectricMutation } from './cross-adapter-mutation-driver'

registerElectricMutation(
  `adapter.electric.mutation-confirmation`,
  observeElectricMutation,
)
