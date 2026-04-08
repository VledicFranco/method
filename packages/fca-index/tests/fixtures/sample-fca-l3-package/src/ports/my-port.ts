/**
 * Sample port interface for the L3 package fixture.
 */

export interface MyPort {
  execute(command: string): Promise<string>;
}
