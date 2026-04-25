/** Sample Scala component public surface. */
package object sample {
  trait SessionPort {
    def open(): Unit
  }
  case class SessionId(value: String)
}
