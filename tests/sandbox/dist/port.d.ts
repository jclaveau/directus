//#region src/port.d.ts
type Port = string | number;
type PortRange = {
  min: Port;
  max: Port;
};
//#endregion
export { Port, PortRange };