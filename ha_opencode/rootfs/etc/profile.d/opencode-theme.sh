get_theme() {
    case "${1}" in
        breeze) echo '{"background":"#232627","foreground":"#fcfcfc","cursor":"#fcfcfc",'
                     echo '"selectionBackground":"#3daee9","black":"#232627","red":"#ed1515",'
                     echo '"green":"#11d116","yellow":"#f67400","blue":"#1d99f3","magenta":"#9b59b6",'
                     echo '"cyan":"#1abc9c","white":"#fcfcfc","brightBlack":"#7f8c8d",'
                     echo '"brightRed":"#c0392b","brightGreen":"#1cdc9a","brightYellow":"#fdbc4b",'
                     echo '"brightBlue":"#3daee9","brightMagenta":"#8e44ad","brightCyan":"#16a085",'
                     echo '"brightWhite":"#ffffff"}' ;;
        catppuccin_mocha)
                     echo '{"background":"#1e1e2e","foreground":"#cdd6f4","cursor":"#f5e0dc",'
                     echo '"selectionBackground":"#585b70","black":"#45475a","red":"#f38ba8",'
                     echo '"green":"#a6e3a1","yellow":"#f9e2af","blue":"#89b4fa","magenta":"#f5c2e7",'
                     echo '"cyan":"#94e2d5","white":"#bac2de","brightBlack":"#585b70",'
                     echo '"brightRed":"#f38ba8","brightGreen":"#a6e3a1","brightYellow":"#f9e2af",'
                     echo '"brightBlue":"#89b4fa","brightMagenta":"#f5c2e7","brightCyan":"#94e2d5",'
                     echo '"brightWhite":"#a6adc8"}' ;;
        catppuccin_latte)
                     echo '{"background":"#eff1f5","foreground":"#4c4f69","cursor":"#dc8a78",'
                     echo '"selectionBackground":"#acb0be","black":"#5c5f77","red":"#d20f39",'
                     echo '"green":"#40a02b","yellow":"#df8e1d","blue":"#1e66f5","magenta":"#ea76cb",'
                     echo '"cyan":"#179299","white":"#acb0be","brightBlack":"#6c6f85",'
                     echo '"brightRed":"#d20f39","brightGreen":"#40a02b","brightYellow":"#df8e1d",'
                     echo '"brightBlue":"#1e66f5","brightMagenta":"#ea76cb","brightCyan":"#179299",'
                     echo '"brightWhite":"#bcc0cc"}' ;;
        dracula)     echo '{"background":"#282a36","foreground":"#f8f8f2","cursor":"#f8f8f2",'
                     echo '"selectionBackground":"#44475a","black":"#21222c","red":"#ff5555",'
                     echo '"green":"#50fa7b","yellow":"#f1fa8c","blue":"#bd93f9","magenta":"#ff79c6",'
                     echo '"cyan":"#8be9fd","white":"#f8f8f2","brightBlack":"#6272a4",'
                     echo '"brightRed":"#ff6e6e","brightGreen":"#69ff94","brightYellow":"#ffffa5",'
                     echo '"brightBlue":"#d6acff","brightMagenta":"#ff92df","brightCyan":"#a4ffff",'
                     echo '"brightWhite":"#ffffff"}' ;;
        nord)        echo '{"background":"#2e3440","foreground":"#d8dee9","cursor":"#d8dee9",'
                     echo '"selectionBackground":"#434c5e","black":"#3b4252","red":"#bf616a",'
                     echo '"green":"#a3be8c","yellow":"#ebcb8b","blue":"#81a1c1","magenta":"#b48ead",'
                     echo '"cyan":"#88c0d0","white":"#e5e9f0","brightBlack":"#4c566a",'
                     echo '"brightRed":"#bf616a","brightGreen":"#a3be8c","brightYellow":"#ebcb8b",'
                     echo '"brightBlue":"#81a1c1","brightMagenta":"#b48ead","brightCyan":"#8fbcbb",'
                     echo '"brightWhite":"#eceff4"}' ;;
        tokyo_night) echo '{"background":"#1a1b26","foreground":"#c0caf5","cursor":"#c0caf5",'
                     echo '"selectionBackground":"#33467c","black":"#15161e","red":"#f7768e",'
                     echo '"green":"#9ece6a","yellow":"#e0af68","blue":"#7aa2f7","magenta":"#bb9af7",'
                     echo '"cyan":"#7dcfff","white":"#a9b1d6","brightBlack":"#414868",'
                     echo '"brightRed":"#f7768e","brightGreen":"#9ece6a","brightYellow":"#e0af68",'
                     echo '"brightBlue":"#7aa2f7","brightMagenta":"#bb9af7","brightCyan":"#7dcfff",'
                     echo '"brightWhite":"#c0caf5"}' ;;
        one_dark)    echo '{"background":"#282c34","foreground":"#abb2bf","cursor":"#528bff",'
                     echo '"selectionBackground":"#3e4451","black":"#282c34","red":"#e06c75",'
                     echo '"green":"#98c379","yellow":"#e5c07b","blue":"#61afef","magenta":"#c678dd",'
                     echo '"cyan":"#56b6c2","white":"#abb2bf","brightBlack":"#5c6370",'
                     echo '"brightRed":"#e06c75","brightGreen":"#98c379","brightYellow":"#e5c07b",'
                     echo '"brightBlue":"#61afef","brightMagenta":"#c678dd","brightCyan":"#56b6c2",'
                     echo '"brightWhite":"#ffffff"}' ;;
        solarized_dark)
                     echo '{"background":"#002b36","foreground":"#839496","cursor":"#839496",'
                     echo '"selectionBackground":"#073642","black":"#073642","red":"#dc322f",'
                     echo '"green":"#859900","yellow":"#b58900","blue":"#268bd2","magenta":"#d33682",'
                     echo '"cyan":"#2aa198","white":"#eee8d5","brightBlack":"#002b36",'
                     echo '"brightRed":"#cb4b16","brightGreen":"#586e75","brightYellow":"#657b83",'
                     echo '"brightBlue":"#839496","brightMagenta":"#6c71c4","brightCyan":"#93a1a1",'
                     echo '"brightWhite":"#fdf6e3"}' ;;
        solarized_light)
                     echo '{"background":"#fdf6e3","foreground":"#657b83","cursor":"#657b83",'
                     echo '"selectionBackground":"#eee8d5","black":"#073642","red":"#dc322f",'
                     echo '"green":"#859900","yellow":"#b58900","blue":"#268bd2","magenta":"#d33682",'
                     echo '"cyan":"#2aa198","white":"#eee8d5","brightBlack":"#002b36",'
                     echo '"brightRed":"#cb4b16","brightGreen":"#586e75","brightYellow":"#657b83",'
                     echo '"brightBlue":"#839496","brightMagenta":"#6c71c4","brightCyan":"#93a1a1",'
                     echo '"brightWhite":"#fdf6e3"}' ;;
        gruvbox_dark) echo '{"background":"#282828","foreground":"#ebdbb2","cursor":"#ebdbb2",'
                     echo '"selectionBackground":"#504945","black":"#282828","red":"#cc241d",'
                     echo '"green":"#98971a","yellow":"#d79921","blue":"#458588","magenta":"#b16286",'
                     echo '"cyan":"#689d6a","white":"#a89984","brightBlack":"#928374",'
                     echo '"brightRed":"#fb4934","brightGreen":"#b8bb26","brightYellow":"#fabd2f",'
                     echo '"brightBlue":"#83a598","brightMagenta":"#d3869b","brightCyan":"#8ec07c",'
                     echo '"brightWhite":"#ebdbb2"}' ;;
        *)           echo '{"background":"#232627","foreground":"#fcfcfc","cursor":"#fcfcfc",'
                     echo '"selectionBackground":"#3daee9","black":"#232627","red":"#ed1515",'
                     echo '"green":"#11d116","yellow":"#f67400","blue":"#1d99f3","magenta":"#9b59b6",'
                     echo '"cyan":"#1abc9c","white":"#fcfcfc","brightBlack":"#7f8c8d",'
                     echo '"brightRed":"#c0392b","brightGreen":"#1cdc9a","brightYellow":"#fdbc4b",'
                     echo '"brightBlue":"#3daee9","brightMagenta":"#8e44ad","brightCyan":"#16a085",'
                     echo '"brightWhite":"#ffffff"}' ;;
    esac
}
