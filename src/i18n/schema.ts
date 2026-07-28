export type MessageShape<T> = {
  [Key in keyof T]: T[Key] extends string ? string : MessageShape<T[Key]>;
};
