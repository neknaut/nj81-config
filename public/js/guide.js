/* The Guide tab: how every part of the page works, in the page's language. Static text only. */

const VI = [
  ["Bắt đầu", [
    "Dùng Chrome hoặc Edge trên máy tính. Trang phải mở bằng HTTPS hoặc localhost (WebHID chỉ chạy ở đó).",
    "Cắm NJ81 bằng cáp USB-C. Bluetooth và 2.4G không mở được phần cấu hình.",
    "Tắt driver Keydous chính hãng và các tab khác đang mở bàn phím, nếu không bàn phím sẽ báo bận.",
    "Bấm «Kết nối bàn phím» rồi chọn NJ81 trong hộp thoại của trình duyệt. Không thấy bàn phím thì bấm «Không thấy bàn phím? Hiện mọi thiết bị».",
    "Kết nối xong, ô bên trái hiện tên, VID/PID, firmware và profile đang dùng. Bấm «Ngắt kết nối» để trả bàn phím cho chương trình khác; tải lại trang vẫn giữ trạng thái ngắt.",
    "Web nhớ tab đang mở: nhấn F5 sẽ quay lại đúng tab đó. Đổi ngôn ngữ VI / EN ở góc dưới bên trái.",
  ]],
  ["Đèn", [
    "«Hiệu ứng»: chọn chế độ đèn, đúng danh sách chế độ của driver Keydous. Mục «Tắt đèn» tắt hẳn đèn.",
    "«Màu»: chọn màu có sẵn hoặc «Màu khác». Bật «Màu cầu vồng» để hiệu ứng dùng nhiều màu thay cho một màu.",
    "«Độ sáng» và «Tốc độ» có 5 mức (0–4). «Hướng» chỉ hiện với hiệu ứng có hướng chạy.",
    "Mỗi thay đổi được gửi ngay và đọc lại để xác nhận. Viên trạng thái trên cùng cho biết: đang gửi, đã gửi, bàn phím đã xác nhận, hoặc bàn phím báo khác. Bấm liên tục nhiều lần thì lần bấm cuối luôn được giữ.",
    "Bảng «Trạng thái» so sánh từng mục web gửi với giá trị bàn phím đang giữ (khớp / khác).",
    "Hình bàn phím mô phỏng hiệu ứng. Gõ trên bàn phím thật khi trang đang mở để thấy phím sáng trên hình. Có thể đổi «Màu keycap trên hình» trắng hoặc đen.",
    "Hiệu ứng phản hồi phím chỉ sáng quanh phím vừa gõ, nên nếu thấy tối thì gõ thử vài phím.",
    "Đổi hiệu ứng ngay trên bàn phím (tổ hợp Fn) thì web tự nhận ra và cập nhật theo. «Dò chế độ đèn của bàn phím» giúp chỉ hiện đúng các chế độ bàn phím có; «Hiện lại mọi hiệu ứng» để trở lại danh sách đầy đủ.",
  ]],
  ["Phím", [
    "Tab Phím chạy như trang chính của driver Keydous. Bấm một phím trên hình để chọn nó: phím được viền đỏ, và các ô bên dưới hiện sẵn cài đặt hiện tại của phím.",
    "Trên hình, phím có cài đặt riêng được tô xanh ngọc, phím bị cấm tô vàng. Đưa chuột lên phím đã tô để xem nó đang làm gì.",
    "Khung «Cài đặt hiện tại»: dòng Profile là việc phím làm ở lớp thường, dòng Lớp Fn là việc phím làm khi giữ Fn, hoặc «(chưa cấu hình)».",
    "Bật «Lớp Fn (phím tắt)» để sửa lớp Fn: mọi phím có chức năng khi giữ Fn sẽ được tô xanh ngọc. Tắt để sửa lớp thường.",
    "Phím Fn là phím hệ thống, không chọn và không đổi được.",
    "«Phím»: chọn tối đa hai trong Ctrl / Alt / Shift / Win rồi thêm một phím. Bấm vào ô phím rồi gõ, hoặc bấm nút bàn phím bên cạnh để chọn trên bàn phím ảo (có cả F13–F24 và bàn phím số). Khi đang sửa phím, gõ một phím ở bất kỳ đâu trên trang cũng điền vào ô đó.",
    "«Media»: phát / dừng, bài trước / sau, âm lượng, tắt tiếng, máy tính, thư, tìm kiếm, độ sáng màn hình, phóng to / thu nhỏ, bật tắt micro… Ở lớp Fn không có mục Fn.",
    "«Chuột»: chuột trái, phải, giữa, tới, lùi, cuộn lên, cuộn xuống.",
    "«Macro»: tick một macro trong danh sách, rồi chọn kiểu chạy: «Lặp» kèm số lần, «Tự chạy (bật / tắt)» hoặc «Khi giữ phím». Kiểu chạy chỉ chọn được khi đã tick một macro.",
    "Ở Phím, Media, Chuột, Macro: bấm lại mục đang tick để bỏ chọn. Chọn xong thì bấm «Xác nhận» để ghi xuống bàn phím.",
    "«Vô hiệu phím» và «Đặt lại» ghi xuống bàn phím ngay khi bấm, không cần «Xác nhận». «Đặt lại» trả phím về mặc định của NJ81-ED; ở lớp Fn thì trả về như lúc web đọc bàn phím lần đầu.",
    "Mỗi lần ghi, web đọc lại bàn phím để chắc chắn và ghi kết quả vào nhật ký. Mọi thay đổi nằm trong bàn phím, không cần mở trang này để dùng.",
  ]],
  ["Macro", [
    "Macro là một chuỗi phím bấm được bàn phím tự gõ lại. Bàn phím có 8 ô macro. Ghi và sửa macro ở tab Macro, còn gán macro cho phím ở tab Phím.",
    "Ở tab Macro: chọn ô, bấm «Ghi macro» rồi gõ các phím trên bàn phím; thời gian giữa các lần nhấn / nhả được giữ nguyên. Bấm «Dừng ghi» khi xong, «Xoá» để làm lại.",
    "Mỗi bước hiện dạng «H ↓ · 61 ms · H ↑»: ↓ là nhấn, ↑ là nhả, ms là thời gian chờ. Một macro chứa được khoảng 120 bước.",
    "«Lưu macro xuống phím» ghi macro vào ô đã chọn và đọc lại để xác nhận. «Đọc từ phím» tải macro đang lưu trong ô đó.",
    "Kiểu «Lặp»: mỗi lần bấm phím, macro chạy đủ số lần đã đặt. Kiểu «Tự chạy (bật / tắt)»: bấm một lần thì macro lặp liên tục, bấm lần nữa thì dừng. Kiểu «Khi giữ phím»: macro lặp trong lúc giữ phím và dừng khi nhả ra.",
    "Số lần lặp được lưu trong chính macro, nên mọi phím dùng chung macro đó cũng lặp cùng số lần.",
    "Lỡ để macro chạy mãi không dừng: bấm lại phím đó, hoặc rút cáp.",
  ]],
  ["Màn hình", [
    "«Chọn ảnh»: chọn ảnh hoặc GIF trên máy, hoặc lấy từ «Thư viện ảnh». Ảnh được xem trước ở đúng cỡ màn hình NJ81 (160×80).",
    "«Cách đặt ảnh vào màn hình»: lấp đầy (cắt bớt) hoặc vừa khít (có viền đen).",
    "GIF: dùng thanh khung hình để xem từng khung, nút Phát / Dừng để xem chuyển động. Tối đa 50 khung; GIF chạy đúng tốc độ của nó.",
    "«Áp dụng lên màn hình» gửi ảnh hoặc GIF xuống bàn phím. Mỗi khung mất vài giây, đừng rút cáp khi đang gửi. Gửi xong, nhấn phím chuyển màn trên bàn phím để xem.",
    "«Xoá ảnh trên phím» gỡ mọi ảnh và GIF (giống nút Clear của driver), mất khoảng 40 giây; màn hình chỉ còn màn thông số. Đừng bấm xoá lại khi đang xoá.",
    "«Đồng bộ giờ» (nút trên hình bàn phím) gửi giờ chuẩn lên màn hình. Web tự làm việc này mỗi lần kết nối.",
    "Mẹo: ảnh ngang tỉ lệ 2:1, nét to, nền tối sẽ dễ nhìn nhất. Các liên kết gợi ý GIF và công cụ cắt GIF nằm ngay trong tab.",
  ]],
  ["Hồ sơ", [
    "Hồ sơ là bộ cài đặt đèn (hiệu ứng, màu, độ sáng, tốc độ…) được lưu lại để dùng lại sau.",
    "Đặt tên rồi bấm «Lưu vào trình duyệt»; chọn hồ sơ đã lưu rồi bấm «Nạp» để lấy lại.",
    "«Xuất JSON» tải hồ sơ về thành file; «Nhập JSON» mở file đó trên máy khác hoặc trình duyệt khác.",
    "«Áp dụng lên bàn phím» gửi cả hồ sơ xuống bàn phím.",
  ]],
  ["Nhật ký", [
    "Ghi lại mọi việc web đã làm và bàn phím đã trả lời: kết nối, đổi đèn, gán phím, macro, gửi ảnh, đồng bộ giờ.",
    "Mỗi lần kết nối bắt đầu một nhật ký mới; ngắt kết nối thì nhật ký được xoá. «Xoá nhật ký» để xoá bằng tay.",
    "Khi có gì không chạy, xem nhật ký trước: dòng báo lỗi cho biết bàn phím đã nhận lệnh hay chưa.",
  ]],
  ["Khi gặp lỗi", [
    "Không thấy bàn phím trong danh sách: kiểm tra cáp USB-C, tắt driver Keydous, đóng tab khác đang mở trang này, rồi thử «Hiện mọi thiết bị».",
    "«Bàn phím không nhận lệnh» hoặc «đã gửi, chưa xác nhận»: bàn phím có thể đang bận lưu. Web tự thử lại; đợi vài giây hoặc bấm lại.",
    "Bàn phím chạy khác với trên web: vào tab Phím bấm «Đọc cấu hình hiện tại», hoặc ngắt rồi kết nối lại để web đọc lại từ bàn phím.",
    "Web không chứa lệnh firmware hay lệnh xoá bộ nhớ, nên không thể làm hỏng bàn phím. Dự án không liên kết với Keydous.",
  ]],
];

const EN = [
  ["Getting started", [
    "Use Chrome or Edge on a computer, with the page opened over HTTPS or localhost (WebHID only works there).",
    "Plug the NJ81 in with a USB-C cable. Bluetooth and 2.4G cannot open the configuration.",
    "Close the official Keydous driver and any other tab that has the keyboard open, or the keyboard will report busy.",
    "Click «Connect keyboard» and pick the NJ81 in the browser's dialog. Not listed? Use «Keyboard not listed? Show all devices».",
    "Once connected, the box on the left shows the name, VID/PID, firmware and active profile. «Disconnect» hands the keyboard back to other programs; a reload stays disconnected.",
    "The page remembers the open tab, so F5 brings you back to it. Switch language (VI / EN) at the bottom left.",
  ]],
  ["Lighting", [
    "«Effect» picks a lighting mode, the same list as the Keydous driver. «Lights off» turns the lights off.",
    "«Colour»: a preset or «Other colour». Tick «Rainbow colours» to use many colours instead of one.",
    "«Brightness» and «Speed» have 5 levels (0–4). «Direction» shows only for effects that move.",
    "Every change is sent at once and read back. The pill at the top says sending, sent, confirmed by the keyboard, or that the keyboard differs. When you click quickly, the last click always wins.",
    "The «Status» table compares what the page sent with what the keyboard holds (match / differs).",
    "The drawing previews the effect. Type on the real keyboard while the page is open to see keys light up. The keycap colour of the drawing can be white or black.",
    "Reactive effects only light up around the key you just typed, so type a few keys if it looks dark.",
    "Changing the effect on the keyboard itself (Fn shortcuts) is picked up by the page. «Learn the keyboard's modes» limits the list to the modes it has; «Show every effect again» brings the full list back.",
  ]],
  ["Keys", [
    "The Keys tab works as the Keydous driver's main page. Click a key on the drawing to pick it: it gets a red border and the editor below shows its current setting.",
    "On the drawing, a key with a setting of its own is tinted cyan and a forbidden key yellow. Hover a tinted key to see what it does.",
    "«Current setting»: the Profile line is what the key does on the normal layer, the Fn layer line what it does while Fn is held, or «(not configured)».",
    "Switch on «Fn layer (shortcuts)» to edit the Fn layer: every key that does something with Fn is tinted cyan. Switch it off for the normal layer.",
    "Fn is a system key: it cannot be picked or changed.",
    "«Key»: up to two of Ctrl / Alt / Shift / Win plus a key. Click the key box and type, or use the keyboard button for the on-screen keyboard (F13–F24 and the number pad too). While a key setting is being edited, a key typed anywhere on the page fills it.",
    "«Media»: play / pause, previous / next, volume, mute, calculator, mail, search, screen brightness, zoom, microphone… The Fn layer has no Fn entry.",
    "«Mouse»: left, right, middle, forward, back, wheel up, wheel down.",
    "«Macro»: tick a macro in the list, then how it plays: «Loop» with a count, «Auto (on / off)» or «While pressed». How it plays can only be set once a macro is ticked.",
    "In Key, Media, Mouse and Macro, clicking the ticked item again clears it. Press «Confirm» to write the choice to the keyboard.",
    "«Disabled» and «Reset» write at once, no Confirm needed. «Reset» puts the key back to the NJ81-ED default; on the Fn layer, to what the page first read from the keyboard.",
    "Every write is read back and logged. Everything is stored in the keyboard; the page does not need to be open to use it.",
  ]],
  ["Macro", [
    "A macro is a sequence of key presses the keyboard types for you. The keyboard has 8 macro slots. Record and edit them in the Macro tab, assign them to keys in the Keys tab.",
    "In the Macro tab: pick a slot, «Record macro», then type on the keyboard; the time between presses and releases is kept. «Stop recording» when done, «Clear» to start over.",
    "Steps read like «H ↓ · 61 ms · H ↑»: ↓ press, ↑ release, ms the wait. A macro holds about 120 steps.",
    "«Save the macro to the keyboard» writes it to the slot and reads it back. «Read from the keyboard» loads what the slot holds.",
    "«Loop»: each press plays the macro the set number of times. «Auto (on / off)»: one press starts it repeating, the next stops it. «While pressed»: it repeats while held and stops on release.",
    "The loop count is stored in the macro itself, so every key using that macro loops the same number of times.",
    "A macro that will not stop: press that key again, or unplug the cable.",
  ]],
  ["Screen", [
    "«Choose a picture»: a picture or GIF from your computer, or one from the «Picture library». The preview is the NJ81 screen size (160×80).",
    "«How the picture fits the screen»: fill the screen (cropped) or fit inside it (black bars).",
    "GIFs: the frame bar steps through frames and Play / Pause shows the motion. Up to 50 frames, played at the GIF's own speed.",
    "«Apply to the screen» sends the picture or GIF. Each frame takes a few seconds; do not unplug while it sends. Then press the screen key on the keyboard to see it.",
    "«Clear keyboard pictures» removes every picture and GIF (as the driver's Clear does) in about 40 seconds; only the stats screen is left. Do not press it again while it runs.",
    "«Sync clock» (above the keyboard drawing) sends the exact time. The page also does it on every connect.",
    "Tip: landscape 2:1 pictures with bold shapes on a dark background read best. Links to GIF ideas and GIF tools are in the tab.",
  ]],
  ["Profiles", [
    "A profile is a set of lighting settings (effect, colour, brightness, speed…) saved to reuse later.",
    "Name it and «Save in this browser»; pick a saved one and «Load» to bring it back.",
    "«Export JSON» downloads it as a file; «Import JSON» opens that file in another browser or computer.",
    "«Apply to keyboard» sends the whole profile.",
  ]],
  ["Log", [
    "Everything the page did and what the keyboard answered: connecting, lighting, keys, macros, pictures, clock.",
    "Each connection starts a new log; disconnecting clears it. «Clear log» clears it by hand.",
    "When something does not work, look at the log first: it says whether the keyboard took the command.",
  ]],
  ["Troubleshooting", [
    "Keyboard not listed: check the USB-C cable, close the Keydous driver and other tabs with this page, then try «Show all devices».",
    "«Keyboard did not take the command» or «sent, not confirmed»: the keyboard may be busy saving. The page retries; wait a few seconds or try again.",
    "Keyboard behaves differently from the page: in Keys press «Read the current setting», or disconnect and connect again.",
    "The page has no firmware or memory-erase commands, so it cannot brick the keyboard. Not affiliated with Keydous.",
  ]],
];

export const renderGuide = (root, language) => {
  const sections = language === "en" ? EN : VI;
  root.replaceChildren(...sections.map(([title, items], n) => {
    const details = document.createElement("details");
    details.className = "guide-item";
    details.open = n === 0;
    const summary = document.createElement("summary");
    summary.textContent = title;
    const list = document.createElement("ul");
    list.append(...items.map((text) => {   // «name» in the text is a button or field name: shown in bold, without the marks
      const li = document.createElement("li");
      text.split(/«([^»]*)»/).forEach((part, i) => { li.append(i % 2 ? Object.assign(document.createElement("strong"), { textContent: part }) : part); });
      return li;
    }));
    details.append(summary, list);
    return details;
  }));
};
