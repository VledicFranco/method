package sample

class SessionSpec {
  def `opens cleanly`(): Unit = {
    new Session().open()
  }
}
