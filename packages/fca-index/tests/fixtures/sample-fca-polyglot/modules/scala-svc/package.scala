/** scala-svc public API. */
package object svc {
  trait SessionPort {
    def open(): Unit
  }
}
